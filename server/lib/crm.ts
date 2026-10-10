import type { Queryable } from "../db";
import { HttpError } from "./http";
import { audit, logActivity } from "./log";

/**
 * One CRM opportunity with everything the board, lists and detail need. Pipeline-aware (WSIS Phase 7):
 * stage kind / order come from pipeline_stages; project opportunities carry the project, the customer's
 * role(s) on it and the linked water interventions.
 * `potential` is the team's own rating when set, otherwise the organization's AI-inferred potential —
 * `potential_source` says which ("team" | "ai"), so an inference is never shown as a judgement.
 */
export const OPP_SELECT = `
  SELECT o.id, o.organization_id, org.name AS organization_name, org.org_type, org.area,
         coalesce(o.potential, org.intelligence->>'potential') AS potential,
         CASE WHEN o.potential IS NOT NULL THEN 'team' WHEN org.intelligence->>'potential' IS NOT NULL THEN 'ai' END AS potential_source,
         o.owner_id, u.name AS owner_name, o.status, o.contact_id, c.name AS contact_name,
         o.last_contact_at, o.next_follow_up, o.notes, o.call_status, o.proposal_status, o.proposal_sent_at, o.pilot_status,
         (SELECT max(a.occurred_at) FROM activities a WHERE a.opportunity_id = o.id) AS last_activity_at,
         o.created_at, o.updated_at, o.pipeline, o.opportunity_type, o.project_id, o.title,
         ps.kind AS stage_kind, ps.is_outcome AS stage_is_outcome, ps.sort_order AS stage_order,
         p.name AS project_name, p.lifecycle_stage AS project_lifecycle_stage, p.area AS project_area,
         (SELECT array_agg(DISTINCT po.role) FROM project_organizations po WHERE po.project_id = o.project_id AND po.organization_id = o.organization_id) AS stakeholder_roles,
         o.source_water_opportunity_id,
         (SELECT array_agg(DISTINCT w.intervention_type) FROM water_opportunities w WHERE w.crm_opportunity_id = o.id) AS interventions,
         nt.title AS next_task_title, nt.due_date AS next_task_due
    FROM crm_opportunities o
    JOIN organizations org ON org.id = o.organization_id
    JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
    LEFT JOIN projects p ON p.id = o.project_id
    LEFT JOIN users u ON u.id = o.owner_id
    LEFT JOIN contacts c ON c.id = o.contact_id
    LEFT JOIN LATERAL (SELECT t.title, t.due_date FROM tasks t WHERE t.opportunity_id = o.id AND t.status = 'Pending' ORDER BY t.due_date NULLS LAST, t.id LIMIT 1) nt ON TRUE`;

/**
 * Where a screen shows a single "relationship" for an organization (the Organization Details CRM panel,
 * the organization list's CRM column), this picks it stably: relationship pipeline, open before closed,
 * oldest first. Project opportunities are never picked as an organization's relationship.
 */
export const PRIMARY_OPPORTUNITY_ORDER =
  "(o.pipeline = 'relationship') DESC, " +
  "EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.pipeline = o.pipeline AND ps.name = o.status AND ps.kind = 'open') DESC, " +
  "o.created_at, o.id";

export interface StageRow {
  name: string;
  sort_order: number;
  kind: "open" | "won" | "lost";
  is_outcome: boolean;
  milestone: string | null;
}

/** Stages of a pipeline, in board order (from pipeline_stages — never hard-coded). */
export async function pipelineStages(q: Queryable, pipeline: string): Promise<StageRow[]> {
  const { rows } = await q.query<StageRow>(`SELECT name, sort_order, kind, is_outcome, milestone FROM pipeline_stages WHERE pipeline = $1 ORDER BY sort_order`, [pipeline]);
  return rows;
}

/** Stage names valid for a pipeline, in board order. */
export async function pipelineStageNames(q: Queryable, pipeline: string): Promise<string[]> {
  return (await pipelineStages(q, pipeline)).map((r) => r.name);
}

/**
 * Automatic stage advancement by milestone (contacted, call, meeting, proposal, pilot, won), for either
 * pipeline: moves forward along the main track only — never backwards, never out of (or into) an outcome
 * stage, and not at all when the pipeline has no stage with that milestone.
 */
export function advanceByMilestone(stages: StageRow[], current: string, milestone: string): string {
  const cur = stages.find((s) => s.name === current);
  const target = stages.find((s) => s.milestone === milestone);
  if (!cur || !target || cur.is_outcome || cur.kind !== "open" || target.is_outcome) return current;
  return target.sort_order > cur.sort_order ? target.name : current;
}

/** A type's pipeline must match the pipeline it is used in (Customer in the project pipeline is a mistake). */
const typeDefault = (typePipeline: string, pipeline: string) => typePipeline !== pipeline;

/** next_follow_up is always the earliest pending task for the opportunity. */
export async function syncNextFollowUp(q: Queryable, opportunityId: number | null | undefined) {
  if (!opportunityId) return;
  await q.query(
    `UPDATE crm_opportunities SET next_follow_up = (SELECT min(due_date) FROM tasks WHERE opportunity_id = $1 AND status = 'Pending') WHERE id = $1`,
    [opportunityId],
  );
}

export async function userName(q: Queryable, id: number | null | undefined): Promise<string> {
  if (!id) return "unknown user";
  const { rows } = await q.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [id]);
  return rows[0]?.name ?? "unknown user";
}

export async function getCrmOpportunity(q: Queryable, id: number) {
  const { rows } = await q.query(`${OPP_SELECT} WHERE o.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Opportunity not found");
  return rows[0];
}

export interface CrmOpportunityInput {
  organizationId: number;
  ownerId?: number | null;
  notes?: string | null;
  contactId?: number | null;
  opportunityType?: string | null;
  pipeline?: string | null;
  projectId?: number | null;
  title?: string | null;
  status?: string | null;
  potential?: string | null;
  sourceWaterOpportunityId?: number | null;
}

/**
 * Create a CRM opportunity (Organization → Opportunity). Defaults: type Customer, the type's default
 * pipeline, the pipeline's first stage. An organization can hold several opportunities; only a second
 * *open* opportunity of the same type for the same project is a conflict (409 with opportunity_id).
 * Used by POST /api/crm and by water-opportunity conversion — always a human action.
 */
export async function createCrmOpportunity(q: Queryable, input: CrmOpportunityInput, actor: number | null, auditBody: object = input) {
  const orgId = input.organizationId;
  const projectId = input.projectId ?? null;
  const { rows: org } = await q.query<{ name: string; merged_into: number | null }>(`SELECT name, merged_into FROM organizations WHERE id = $1`, [orgId]);
  if (!org[0] || org[0].merged_into) throw new HttpError(404, "Organization not found");

  const type = input.opportunityType ? String(input.opportunityType) : "Customer";
  const typeRow = (await q.query<{ default_pipeline: string }>(`SELECT default_pipeline FROM opportunity_types WHERE name = $1 AND active`, [type])).rows[0];
  if (!typeRow) throw new HttpError(400, `Unknown opportunity type "${type}"`);
  const pipe = input.pipeline ? String(input.pipeline) : typeRow.default_pipeline;
  const stages = await pipelineStageNames(q, pipe);
  if (!stages.length) throw new HttpError(400, `Unknown pipeline "${pipe}"`);
  const stage = input.status ? String(input.status) : stages[0];
  if (!stages.includes(stage)) throw new HttpError(400, `"${stage}" is not a stage of the ${pipe} pipeline`);
  let projectName: string | null = null;
  if (projectId) {
    const p = (await q.query<{ name: string; merged_into: number | null }>(`SELECT name, merged_into FROM projects WHERE id = $1`, [projectId])).rows[0];
    if (!p || p.merged_into) throw new HttpError(404, "Project not found");
    projectName = p.name;
  }

  const { rows: ex } = await q.query<{ id: number }>(
    `SELECT o.id FROM crm_opportunities o JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
      WHERE o.organization_id = $1 AND o.opportunity_type = $2 AND coalesce(o.project_id, 0) = $3 AND ps.kind = 'open'`,
    [orgId, type, projectId ?? 0],
  );
  if (ex[0]) {
    const msg = type === "Customer" && !projectId ? "This organization is already in the CRM" : `An open ${type} opportunity already exists for this organization${projectName ? ` on ${projectName}` : ""}`;
    throw new HttpError(409, msg, { opportunity_id: ex[0].id });
  }
  if (typeDefault(typeRow.default_pipeline, pipe)) throw new HttpError(400, `"${type}" is a ${typeRow.default_pipeline} opportunity type, not for the ${pipe} pipeline`);
  if (pipe === "project" && !projectId) throw new HttpError(400, "A project opportunity needs a project");
  if (projectId) {
    const link = await q.query(`SELECT 1 FROM project_organizations WHERE project_id = $1 AND organization_id = $2`, [projectId, orgId]);
    if (!link.rows.length) throw new HttpError(400, "The customer must be a stakeholder organization on the project");
  }
  const potential = input.potential ? String(input.potential) : null;
  if (potential && !["High", "Medium", "Low", "Unknown"].includes(potential)) throw new HttpError(400, "Invalid potential");
  const title = typeof input.title === "string" ? input.title.trim() || null : null;
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO crm_opportunities (organization_id, owner_id, notes, contact_id, created_by, opportunity_type, pipeline, project_id, title, status, potential, source_water_opportunity_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [orgId, input.ownerId || null, input.notes || null, input.contactId || null, actor, type, pipe, projectId, title, stage, potential, input.sourceWaterOpportunityId ?? null],
  );
  const id = rows[0].id;
  const who = await userName(q, actor);
  const what = type === "Customer" && !projectId ? "" : ` as ${type}${projectName ? ` for project ${projectName}` : ""}`;
  await logActivity(q, { organizationId: orgId, opportunityId: id, type: "crm_added", summary: `Added to CRM${what} by ${who}`, details: { opportunity_type: type, pipeline: pipe, project_id: projectId }, actorId: actor });
  if (input.ownerId) await logActivity(q, { organizationId: orgId, opportunityId: id, type: "assigned", summary: `Assigned to ${await userName(q, input.ownerId)}`, actorId: actor });
  // The activity carries the project (activities.project_id), so it shows on the project timeline once — no copy.
  await audit(q, actor, "crm_opportunity", id, "create", auditBody);
  return getCrmOpportunity(q, id);
}

export interface PipelineCounts {
  total: number;
  open: number;
  /** Open opportunities with an open Next Action Agent recommendation. */
  needingAction: number;
  /** Open opportunities with a follow-up due today or overdue. */
  followUpsDue: number;
  /** Open opportunities whose proposal is being drafted or has been sent, or that are at the proposal stage. */
  inProposal: number;
  proposalsAwaitingResponse: number;
  /** Pilot planned or in progress, or at the pilot stage. */
  pilots: number;
  won: number;
}

/** Per-pipeline CRM counts from real rows (dashboard and daily brief). `userId` limits to that owner. */
export async function crmPipelineCounts(q: Queryable, today: string, userId: number | null = null): Promise<Record<"relationship" | "project", PipelineCounts>> {
  const { rows } = await q.query<PipelineCounts & { pipeline: string }>(
    `SELECT pl.key AS pipeline,
            count(o.id)::int AS total,
            count(o.id) FILTER (WHERE ps.kind = 'open')::int AS open,
            count(o.id) FILTER (WHERE ps.kind = 'open' AND EXISTS (
              SELECT 1 FROM agent_recommendations r WHERE r.opportunity_id = o.id AND r.agent = 'next_action' AND r.status = 'open'))::int AS "needingAction",
            count(o.id) FILTER (WHERE ps.kind = 'open' AND o.next_follow_up <= $1)::int AS "followUpsDue",
            count(o.id) FILTER (WHERE ps.kind = 'open' AND (o.proposal_status IN ('Drafting', 'Sent') OR ps.milestone = 'proposal'))::int AS "inProposal",
            count(o.id) FILTER (WHERE ps.kind = 'open' AND o.proposal_status = 'Sent')::int AS "proposalsAwaitingResponse",
            count(o.id) FILTER (WHERE ps.kind = 'open' AND (o.pilot_status IN ('Planned', 'In Progress') OR ps.milestone = 'pilot'))::int AS pilots,
            count(o.id) FILTER (WHERE ps.kind = 'won')::int AS won
       FROM pipelines pl
       LEFT JOIN crm_opportunities o ON o.pipeline = pl.key AND ($2::int IS NULL OR o.owner_id = $2)
       LEFT JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
      GROUP BY pl.key`,
    [today, userId],
  );
  const empty: PipelineCounts = { total: 0, open: 0, needingAction: 0, followUpsDue: 0, inProposal: 0, proposalsAwaitingResponse: 0, pilots: 0, won: 0 };
  const by = (k: string) => {
    const r = rows.find((x) => x.pipeline === k);
    if (!r) return { ...empty };
    const { pipeline: _p, ...c } = r;
    return c;
  };
  return { relationship: by("relationship"), project: by("project") };
}
