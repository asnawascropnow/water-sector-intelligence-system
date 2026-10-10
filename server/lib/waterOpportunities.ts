import type { Queryable } from "../db";
import { FACT_PROVENANCE, WATER_OPPORTUNITY_OUTCOMES, type DataConfidence, type FactProvenance, type Potential, type WaterOpportunityOutcome, type WaterOpportunityStatus } from "../../shared/constants";
import type { EvidenceRef, WaterGenerateResult, WaterOpportunity, WaterOpportunityCounts, WaterOpportunityHistoryEntry } from "../../shared/types";
import { HttpError } from "./http";
import { audit, logActivity, logProjectActivity } from "./log";
import { inCatalog } from "./catalog";
import { createCrmOpportunity, getCrmOpportunity, userName } from "./crm";
import { evaluateOrganization, evaluateProject, evidenceSignature, loadOrganizationContext, loadProjectContext, WATER_AGENT, type WaterDraft } from "../agents/waterOpportunity";

/**
 * Water opportunities: potential interventions on a project and/or organization (WSIS Phases 2 and 6).
 *
 * Review model:  suggested → needs_review → approved | rejected;  approved → converted (CRM) → closed.
 * - suggestWaterOpportunity: agent output → 'suggested', labelled AI Inference, no reviewer.
 * - createWaterOpportunity: entered by a person → approved, with that person as reviewer.
 * - reviewWaterOpportunity / changeWaterStatus: a named person moves it through the model.
 * - convertWaterOpportunity: a person creates or links the CRM opportunity. Nothing creates CRM records
 *   automatically, and nothing is deleted: rejected and closed opportunities stay for audit.
 * Project opportunities belong to the project; they are never copied onto stakeholder organizations.
 */

const LIVE = `status NOT IN ('rejected', 'closed')`;

export const WATER_SELECT = `
  SELECT w.id, w.project_id, w.organization_id, w.intervention_type, it.key AS intervention_key, it.group_key AS intervention_group, w.context_key,
         w.potential, w.reason, w.evidence, w.evidence_refs, w.evidence_current, w.source, w.provenance, w.confidence, w.origin,
         w.suggested_by_agent, w.rule_key, w.status, w.outcome, w.reviewed_by, ru.name AS reviewer_name, w.reviewed_at, w.review_note,
         w.owner_id, ou.name AS owner_name, w.crm_opportunity_id, co.status AS crm_status, co.pipeline AS crm_pipeline,
         co.organization_id AS crm_organization_id, corg.name AS crm_organization_name,
         p.name AS project_name, org.name AS organization_name, cu.name AS created_by_name, uu.name AS updated_by_name,
         w.refreshed_at, w.created_at, w.updated_at
    FROM water_opportunities w
    JOIN water_intervention_types it ON it.name = w.intervention_type
    LEFT JOIN projects p ON p.id = w.project_id
    LEFT JOIN organizations org ON org.id = w.organization_id
    LEFT JOIN users ru ON ru.id = w.reviewed_by
    LEFT JOIN users ou ON ou.id = w.owner_id
    LEFT JOIN users cu ON cu.id = w.created_by
    LEFT JOIN users uu ON uu.id = w.updated_by
    LEFT JOIN crm_opportunities co ON co.id = w.crm_opportunity_id
    LEFT JOIN organizations corg ON corg.id = co.organization_id`;

/** Display order: live first by status, higher potential first, then oldest. */
export const WATER_ORDER = `
  CASE w.status WHEN 'suggested' THEN 0 WHEN 'needs_review' THEN 1 WHEN 'approved' THEN 2 WHEN 'converted' THEN 3 WHEN 'rejected' THEN 4 ELSE 5 END,
  CASE w.potential WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 WHEN 'Low' THEN 2 ELSE 3 END, it.sort_order, w.created_at, w.id`;

/** Mark evidence whose fact version has since been changed or withdrawn (the opportunity keeps its snapshot). */
async function markSuperseded(q: Queryable, items: WaterOpportunity[]): Promise<WaterOpportunity[]> {
  const ids = (e: EvidenceRef["entity"]) => [...new Set(items.flatMap((w) => w.evidence_refs.filter((r) => r.kind === "fact" && r.entity === e && r.fact_id).map((r) => r.fact_id!)))];
  const retired = new Set<string>();
  for (const [entity, table] of [["project", "project_facts"], ["organization", "organization_facts"]] as const) {
    const list = ids(entity);
    if (!list.length) continue;
    const { rows } = await q.query<{ id: number }>(`SELECT id FROM ${table} WHERE id = ANY($1::int[]) AND retired_at IS NOT NULL`, [list]);
    for (const r of rows) retired.add(`${entity}:${r.id}`);
  }
  if (!retired.size) return items;
  return items.map((w) => ({ ...w, evidence_refs: w.evidence_refs.map((r) => (r.fact_id && retired.has(`${r.entity}:${r.fact_id}`) ? { ...r, superseded: true } : r)) }));
}

export async function listWaterOpportunities(
  q: Queryable,
  f: { projectId?: number; organizationId?: number; organizationLevelOnly?: boolean; statuses?: string[] } = {},
): Promise<WaterOpportunity[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: (n: number) => string, v: unknown) => {
    params.push(v);
    where.push(sql(params.length));
  };
  if (f.projectId) add((n) => `w.project_id = $${n}`, f.projectId);
  if (f.organizationId) add((n) => `w.organization_id = $${n}`, f.organizationId);
  if (f.organizationLevelOnly) where.push(`w.project_id IS NULL`);
  if (f.statuses?.length) add((n) => `w.status = ANY($${n}::text[])`, f.statuses);
  const { rows } = await q.query<WaterOpportunity>(`${WATER_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${WATER_ORDER} LIMIT 1000`, params);
  return markSuperseded(q, rows);
}

/**
 * Water opportunities on the projects an organization is linked to. They belong to the project — the
 * organization's role(s) on it are attached so the UI can say so, but nothing is implied for the
 * organization as a whole.
 */
export async function organizationProjectWaterOpportunities(q: Queryable, organizationId: number): Promise<WaterOpportunity[]> {
  const { rows } = await q.query<WaterOpportunity>(
    `${WATER_SELECT}
      LEFT JOIN LATERAL (SELECT array_agg(po.role ORDER BY po.role) AS roles FROM project_organizations po WHERE po.project_id = w.project_id AND po.organization_id = $1) r ON TRUE
      WHERE w.project_id IS NOT NULL AND p.merged_into IS NULL
        AND (r.roles IS NOT NULL OR w.organization_id = $1)
      ORDER BY p.name, ${WATER_ORDER}`.replace(`SELECT w.id,`, `SELECT coalesce(r.roles, '{}') AS organization_roles, w.id,`),
    [organizationId],
  );
  return markSuperseded(q, rows);
}

export async function getWaterOpportunity(q: Queryable, id: number): Promise<WaterOpportunity> {
  const { rows } = await q.query<WaterOpportunity>(`${WATER_SELECT} WHERE w.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Water opportunity not found");
  return (await markSuperseded(q, rows))[0];
}

export async function waterOpportunityHistory(q: Queryable, id: number): Promise<WaterOpportunityHistoryEntry[]> {
  const { rows } = await q.query<WaterOpportunityHistoryEntry>(
    `SELECT a.id, a.action, u.name AS actor_name, a.changes, a.at FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.entity = 'water_opportunity' AND a.entity_id = $1 ORDER BY a.at, a.id`,
    [id],
  );
  return rows;
}

/** Log on the project timeline and/or the organization timeline, whichever the opportunity belongs to. */
async function logWater(q: Queryable, w: { project_id: number | null; organization_id: number | null }, type: string, summary: string, actorId: number | null, details: object = {}) {
  if (w.project_id) await logProjectActivity(q, { projectId: w.project_id, type, summary, details, actorId });
  if (w.organization_id) await logActivity(q, { organizationId: w.organization_id, type, summary, details, actorId });
}

/* ------------------------------------------------------------------ create */

interface Target {
  projectId?: number | null;
  organizationId?: number | null;
}
interface Common extends Target {
  interventionType: string;
  contextKey?: string | null;
  potential?: Potential;
  reason: string;
  evidence?: string | null;
  evidenceRefs?: EvidenceRef[];
  source?: string | null;
  sourceId?: number | null;
  confidence?: DataConfidence;
}

const contextOf = (c: { contextKey?: string | null }) => (c.contextKey ?? "").trim();

async function validate(q: Queryable, c: Common) {
  if (!c.projectId && !c.organizationId) throw new HttpError(400, "A water opportunity needs a project or an organization");
  if (c.projectId && !(await q.query(`SELECT 1 FROM projects WHERE id = $1 AND merged_into IS NULL`, [c.projectId])).rows.length) throw new HttpError(404, "Project not found");
  if (c.organizationId && !(await q.query(`SELECT 1 FROM organizations WHERE id = $1 AND merged_into IS NULL`, [c.organizationId])).rows.length) throw new HttpError(404, "Organization not found");
  if (!(await inCatalog(q, "water_intervention_types", c.interventionType))) throw new HttpError(400, `Unknown intervention type "${c.interventionType}"`);
  if (!c.reason?.trim()) throw new HttpError(400, "Explain why this intervention may fit");
  const live = await findLive(q, c);
  if (live) throw new HttpError(409, `An open ${c.interventionType} opportunity already exists here`, { water_opportunity_id: live.id });
}

async function findLive(q: Queryable, c: Common) {
  const { rows } = await q.query<{ id: number; status: WaterOpportunityStatus; origin: string; evidence_signature: string | null; evidence_current: boolean }>(
    `SELECT id, status, origin, evidence_signature, evidence_current FROM water_opportunities
      WHERE coalesce(project_id, 0) = $1 AND coalesce(organization_id, 0) = $2 AND intervention_type = $3 AND context_key = $4 AND ${LIVE}`,
    [c.projectId ?? 0, c.organizationId ?? 0, c.interventionType, contextOf(c)],
  );
  return rows[0] ?? null;
}

const evidenceText = (refs: EvidenceRef[]) =>
  refs.map((r) => `${r.label}: ${r.value} (${r.provenance}${r.source ? `, ${r.source}` : ""})`).join("; ") || null;
const sourcesText = (refs: EvidenceRef[]) => [...new Set(refs.map((r) => r.source).filter(Boolean))].join("; ") || null;

async function insert(
  q: Queryable,
  c: Common,
  fields: { provenance: FactProvenance; origin: "manual" | "ai" | "import"; agent: string | null; ruleKey?: string | null; status: "suggested" | "approved"; reviewer: number | null; actorId: number | null; ownerId?: number | null },
) {
  const refs = c.evidenceRefs ?? [];
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO water_opportunities (project_id, organization_id, intervention_type, context_key, potential, reason, evidence, evidence_refs, evidence_signature,
                                      source, source_id, provenance, confidence, origin, suggested_by_agent, rule_key, status, reviewed_by, reviewed_at,
                                      owner_id, created_by, updated_by, refreshed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CASE WHEN $18::int IS NULL THEN NULL ELSE now() END,
             $19, $20, $20, CASE WHEN $14 = 'ai' THEN now() ELSE NULL END)
     RETURNING id`,
    [
      c.projectId ?? null, c.organizationId ?? null, c.interventionType, contextOf(c), c.potential ?? "Unknown", c.reason.trim(),
      c.evidence?.trim() || evidenceText(refs), JSON.stringify(refs), refs.length ? evidenceSignature(refs) : null,
      c.source?.trim() || sourcesText(refs), c.sourceId ?? null, fields.provenance, c.confidence ?? "Unknown", fields.origin, fields.agent, fields.ruleKey ?? null,
      fields.status, fields.reviewer, fields.ownerId ?? null, fields.actorId,
    ],
  );
  return getWaterOpportunity(q, rows[0].id);
}

export async function suggestWaterOpportunity(q: Queryable, c: Common & { agent: string; ruleKey?: string | null }): Promise<WaterOpportunity> {
  await validate(q, c);
  const w = await insert(q, c, { provenance: "AI Inference", origin: "ai", agent: c.agent, ruleKey: c.ruleKey, status: "suggested", reviewer: null, actorId: null });
  await audit(q, null, "water_opportunity", w.id, "suggest", { agent: c.agent, rule: c.ruleKey ?? null, intervention: c.interventionType, potential: w.potential, confidence: w.confidence, evidence_signature: w.evidence_refs.length ? evidenceSignature(w.evidence_refs) : null });
  await logWater(q, w, "water_suggested", `Water opportunity suggested (AI Inference): ${w.intervention_type} — awaiting review`, null, { water_opportunity_id: w.id });
  return w;
}

export async function createWaterOpportunity(q: Queryable, c: Common & { provenance: FactProvenance; ownerId?: number | null }, actorId: number): Promise<WaterOpportunity> {
  if (!actorId) throw new HttpError(400, "A person must create manual water opportunities");
  if (!FACT_PROVENANCE.includes(c.provenance)) throw new HttpError(400, "Invalid provenance");
  if (c.provenance === "AI Inference") throw new HttpError(400, "AI-inferred opportunities must go through the suggestion review");
  await validate(q, c);
  const w = await insert(q, c, { provenance: c.provenance, origin: "manual", agent: null, status: "approved", reviewer: actorId, actorId, ownerId: c.ownerId });
  await logWater(q, w, "water_opportunity", `Water opportunity added: ${c.interventionType} — ${c.reason.trim()}`, actorId, { water_opportunity_id: w.id });
  await audit(q, actorId, "water_opportunity", w.id, "create", c);
  return w;
}

/* ------------------------------------------------------------------ review & status */

async function current(q: Queryable, id: number) {
  const cur = (await q.query<WaterOpportunity & { evidence_signature: string | null }>(`SELECT * FROM water_opportunities WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!cur) throw new HttpError(404, "Water opportunity not found");
  return cur;
}

/** A person approves or rejects a suggestion (from suggested or needs_review). */
export async function reviewWaterOpportunity(q: Queryable, id: number, decision: "approve" | "reject", actorId: number | null, note?: string | null): Promise<WaterOpportunity> {
  if (!actorId) throw new HttpError(400, "A named person must review suggestions");
  const cur = await current(q, id);
  if (cur.status !== "suggested" && cur.status !== "needs_review") throw new HttpError(409, `Already ${cur.status}`);
  const status = decision === "approve" ? "approved" : "rejected";
  await q.query(
    `UPDATE water_opportunities SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_by = $3, updated_at = now() WHERE id = $1`,
    [id, status, actorId, note?.trim() || null],
  );
  const who = await userName(q, actorId);
  await logWater(
    q,
    cur,
    "water_opportunity_review",
    `${decision === "approve" ? "Approved" : "Rejected"} ${cur.origin === "ai" ? "suggested " : ""}${cur.intervention_type} opportunity (${who})${note?.trim() ? `: ${note.trim()}` : ""}`,
    actorId,
    { water_opportunity_id: id },
  );
  await audit(q, actorId, "water_opportunity", id, decision, { from: cur.status, to: status, note: note?.trim() || null });
  return getWaterOpportunity(q, id);
}

/** Begin review of a suggestion: suggested → needs_review, optionally assigning who will review it. */
export async function startReview(q: Queryable, id: number, actorId: number | null, opts: { ownerId?: number | null; note?: string | null } = {}): Promise<WaterOpportunity> {
  if (!actorId) throw new HttpError(400, "A named person must start the review");
  const cur = await current(q, id);
  if (cur.status !== "suggested") throw new HttpError(409, `Already ${cur.status}`);
  await q.query(`UPDATE water_opportunities SET status = 'needs_review', owner_id = coalesce($3, owner_id), updated_by = $2, updated_at = now() WHERE id = $1`, [id, actorId, opts.ownerId ?? null]);
  const who = await userName(q, actorId);
  await logWater(q, cur, "water_opportunity_review", `${cur.intervention_type} suggestion moved to review by ${who}${opts.note?.trim() ? `: ${opts.note.trim()}` : ""}`, actorId, { water_opportunity_id: id });
  await audit(q, actorId, "water_opportunity", id, "start_review", { from: cur.status, to: "needs_review", owner_id: opts.ownerId ?? null, note: opts.note?.trim() || null });
  return getWaterOpportunity(q, id);
}

/**
 * Human status changes after review:
 *   approved | converted → closed (with an outcome);  closed → approved/converted (reopen);
 *   rejected → needs_review (reconsider). Conversion has its own function.
 */
export async function changeWaterStatus(
  q: Queryable,
  id: number,
  to: WaterOpportunityStatus,
  actorId: number | null,
  opts: { outcome?: string | null; note?: string | null } = {},
): Promise<WaterOpportunity> {
  if (!actorId) throw new HttpError(400, "A named person must change the status");
  const cur = await current(q, id);
  const note = opts.note?.trim() || null;
  if (to === "approved" || to === "rejected") {
    if (cur.status === "suggested" || cur.status === "needs_review") return reviewWaterOpportunity(q, id, to === "approved" ? "approve" : "reject", actorId, note);
  }
  let next: WaterOpportunityStatus;
  let outcome: WaterOpportunityOutcome | null = null;
  if (to === "closed") {
    if (cur.status !== "approved" && cur.status !== "converted") throw new HttpError(409, `A ${cur.status} opportunity cannot be closed`);
    if (!opts.outcome || !WATER_OPPORTUNITY_OUTCOMES.includes(opts.outcome as WaterOpportunityOutcome)) throw new HttpError(400, `Choose an outcome: ${WATER_OPPORTUNITY_OUTCOMES.join(", ")}`);
    next = "closed";
    outcome = opts.outcome as WaterOpportunityOutcome;
  } else if (to === "approved" && cur.status === "closed") {
    next = cur.crm_opportunity_id ? "converted" : "approved";
  } else if (to === "needs_review" && cur.status === "rejected") {
    next = "needs_review";
  } else if (to === "converted") {
    throw new HttpError(400, "Use convert to link a CRM opportunity");
  } else if (to === cur.status) {
    return getWaterOpportunity(q, id);
  } else {
    throw new HttpError(409, `Cannot change a ${cur.status} opportunity to ${to}`);
  }
  if (next !== "closed" && (cur.status === "closed" || cur.status === "rejected")) {
    const live = await findLive(q, { projectId: cur.project_id, organizationId: cur.organization_id, interventionType: cur.intervention_type, contextKey: cur.context_key, reason: "x" });
    if (live) throw new HttpError(409, `Another open ${cur.intervention_type} opportunity already exists here`, { water_opportunity_id: live.id });
  }
  await q.query(
    `UPDATE water_opportunities SET status = $2, outcome = $3, updated_by = $4, updated_at = now(),
            reviewed_by = CASE WHEN $2 IN ('approved','converted','closed') THEN coalesce(reviewed_by, $4) ELSE reviewed_by END,
            reviewed_at = CASE WHEN $2 IN ('approved','converted','closed') THEN coalesce(reviewed_at, now()) ELSE reviewed_at END
      WHERE id = $1`,
    [id, next, outcome, actorId],
  );
  const who = await userName(q, actorId);
  const verb = next === "closed" ? `closed (${outcome!.replace("_", " ")})` : cur.status === "rejected" ? "reopened for review" : "reopened";
  await logWater(q, cur, "water_opportunity_status", `${cur.intervention_type} opportunity ${verb} by ${who}${note ? `: ${note}` : ""}`, actorId, { water_opportunity_id: id, from: cur.status, to: next });
  await audit(q, actorId, "water_opportunity", id, "status", { from: cur.status, to: next, outcome, note });
  return getWaterOpportunity(q, id);
}

export async function updateWaterOpportunity(q: Queryable, id: number, b: { owner_id?: number | null; potential?: string }, actorId: number | null): Promise<WaterOpportunity> {
  if (!actorId) throw new HttpError(400, "A named person must make changes");
  const cur = await current(q, id);
  const sets: string[] = [];
  const params: unknown[] = [id];
  const changes: Record<string, [unknown, unknown]> = {};
  const who = await userName(q, actorId);
  if ("owner_id" in b && (b.owner_id || null) !== cur.owner_id) {
    const owner = b.owner_id || null;
    if (owner && !(await q.query(`SELECT 1 FROM users WHERE id = $1`, [owner])).rows.length) throw new HttpError(400, "Unknown user");
    params.push(owner);
    sets.push(`owner_id = $${params.length}`);
    changes.owner_id = [cur.owner_id, owner];
    await logWater(q, cur, "water_opportunity_owner", owner ? `${cur.intervention_type} opportunity assigned to ${await userName(q, owner)} by ${who}` : `${cur.intervention_type} opportunity owner removed by ${who}`, actorId, { water_opportunity_id: id });
  }
  if ("potential" in b && b.potential !== cur.potential) {
    if (!["High", "Medium", "Low", "Unknown"].includes(String(b.potential))) throw new HttpError(400, "Invalid potential");
    params.push(b.potential);
    sets.push(`potential = $${params.length}`);
    changes.potential = [cur.potential, b.potential];
    await logWater(q, cur, "water_opportunity_potential", `${cur.intervention_type} potential changed ${cur.potential} → ${b.potential} by ${who}`, actorId, { water_opportunity_id: id });
  }
  if (sets.length) {
    params.push(actorId);
    await q.query(`UPDATE water_opportunities SET ${sets.join(", ")}, updated_by = $${params.length}, updated_at = now() WHERE id = $1`, params);
    await audit(q, actorId, "water_opportunity", id, "update", changes);
  }
  return getWaterOpportunity(q, id);
}

/* ------------------------------------------------------------------ CRM conversion */

/**
 * Convert an approved water opportunity to a CRM opportunity — always a human action.
 * - Project opportunity: the customer is a stakeholder organization chosen by the user; the CRM
 *   opportunity is in the Project Opportunity pipeline and keeps the project link.
 * - Organization-level opportunity: the organization's relationship pipeline.
 * Either create a new CRM opportunity or link an existing compatible one (crmOpportunityId).
 */
export async function convertWaterOpportunity(
  q: Queryable,
  id: number,
  input: { organizationId?: number | null; opportunityType?: string | null; ownerId?: number | null; title?: string | null; crmOpportunityId?: number | null },
  actorId: number | null,
): Promise<{ water_opportunity: WaterOpportunity; crm_opportunity: Awaited<ReturnType<typeof getCrmOpportunity>>; created: boolean }> {
  if (!actorId) throw new HttpError(400, "A named person must convert opportunities");
  const cur = await current(q, id);
  if (cur.crm_opportunity_id || cur.status === "converted") throw new HttpError(409, "Already converted to a CRM opportunity", { opportunity_id: cur.crm_opportunity_id });
  if (cur.status !== "approved") throw new HttpError(409, "Only approved opportunities can be converted to CRM");

  const isProject = Boolean(cur.project_id);
  const pipeline = isProject ? "project" : "relationship";
  const linking = Boolean(input.crmOpportunityId);
  const orgId = isProject ? input.organizationId ?? cur.organization_id : cur.organization_id;
  if (!orgId && !linking) throw new HttpError(400, "Choose the stakeholder organization this opportunity is with");
  if (!isProject && input.organizationId && input.organizationId !== cur.organization_id) throw new HttpError(400, "An organization-level opportunity converts for that organization only");
  if (isProject && orgId && !linking) {
    const link = await q.query(`SELECT 1 FROM project_organizations WHERE project_id = $1 AND organization_id = $2`, [cur.project_id, orgId]);
    if (!link.rows.length) throw new HttpError(400, "Choose an organization linked to this project as a stakeholder");
  }
  const projectName = isProject ? (await q.query<{ name: string }>(`SELECT name FROM projects WHERE id = $1`, [cur.project_id])).rows[0]?.name : null;

  let crm: Awaited<ReturnType<typeof getCrmOpportunity>>;
  let created = false;
  if (input.crmOpportunityId) {
    crm = await getCrmOpportunity(q, input.crmOpportunityId);
    if (crm.pipeline !== pipeline) throw new HttpError(400, `Link a ${pipeline === "project" ? "Project Opportunity" : "relationship"} pipeline CRM opportunity`);
    if (isProject ? crm.project_id !== cur.project_id : crm.organization_id !== cur.organization_id || crm.project_id) {
      throw new HttpError(400, isProject ? "That CRM opportunity is not for this project" : "That CRM opportunity is not this organization's relationship");
    }
  } else {
    const type = input.opportunityType || (isProject ? "Project Opportunity" : "Customer");
    const t = (await q.query<{ default_pipeline: string }>(`SELECT default_pipeline FROM opportunity_types WHERE name = $1 AND active`, [type])).rows[0];
    if (!t) throw new HttpError(400, `Unknown opportunity type "${type}"`);
    if (t.default_pipeline !== pipeline) throw new HttpError(400, `"${type}" is not a ${pipeline === "project" ? "project" : "relationship"} opportunity type`);
    crm = await createCrmOpportunity(
      q,
      {
        organizationId: orgId!,
        opportunityType: type,
        pipeline,
        projectId: cur.project_id,
        ownerId: input.ownerId ?? cur.owner_id,
        title: input.title?.trim() || (projectName ? `${cur.intervention_type} — ${projectName}` : cur.intervention_type),
        notes: `From approved water opportunity: ${cur.reason}`,
        potential: cur.potential,
        sourceWaterOpportunityId: id,
      },
      actorId,
      { from_water_opportunity: id },
    );
    created = true;
  }

  await q.query(`UPDATE water_opportunities SET status = 'converted', crm_opportunity_id = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [id, crm.id, actorId]);
  const who = await userName(q, actorId);
  const summary = `${cur.intervention_type} opportunity ${created ? "converted to a new" : "linked to an existing"} CRM opportunity with ${crm.organization_name} (${pipeline === "project" ? "Project Opportunity" : "relationship"} pipeline) by ${who}`;
  // One timeline entry on the CRM opportunity; it carries the project, so it also shows on the project timeline.
  await logActivity(q, { organizationId: crm.organization_id, opportunityId: crm.id, type: "water_opportunity_converted", summary, details: { water_opportunity_id: id }, actorId });
  await audit(q, actorId, "water_opportunity", id, "convert", { crm_opportunity_id: crm.id, created, organization_id: crm.organization_id, pipeline });
  return { water_opportunity: await getWaterOpportunity(q, id), crm_opportunity: crm, created };
}

/* ------------------------------------------------------------------ applying the rule engine */

/**
 * Run the water opportunity rules for one project or organization and apply the result:
 * - a new hypothesis becomes a 'suggested' opportunity (AI Inference);
 * - an existing open AI suggestion for the same intervention is refreshed in place, not duplicated;
 * - approved / converted / manual opportunities are left exactly as the person decided;
 * - a hypothesis a person already rejected (or closed) on the same evidence is not resurfaced; on changed
 *   evidence a new suggestion is made and says so;
 * - open AI suggestions whose rule no longer fires are flagged (evidence_current = false), never deleted.
 */
export async function generateWaterOpportunities(q: Queryable, target: { projectId?: number; organizationId?: number }, actorId: number | null): Promise<WaterGenerateResult> {
  let drafts: WaterDraft[];
  const t: Target = target.projectId ? { projectId: target.projectId, organizationId: null } : { projectId: null, organizationId: target.organizationId };
  if (t.projectId) {
    const ctx = await loadProjectContext(q, t.projectId);
    if (!ctx) throw new HttpError(404, "Project not found");
    drafts = evaluateProject(ctx);
  } else if (t.organizationId) {
    const ctx = await loadOrganizationContext(q, t.organizationId);
    if (!ctx) throw new HttpError(404, "Organization not found");
    drafts = evaluateOrganization(ctx);
  } else throw new HttpError(400, "project_id or organization_id is required");

  const result: WaterGenerateResult = { created: 0, refreshed: 0, unchanged: 0, kept: 0, skipped_rejected: 0, stale: 0, opportunities: [] };
  const touched = new Set<number>();
  for (const d of drafts) {
    const c: Common = { ...t, interventionType: d.intervention, contextKey: d.context_key, potential: d.potential, reason: d.reason, evidenceRefs: d.evidence_refs, confidence: d.confidence };
    const signature = evidenceSignature(d.evidence_refs);
    const live = await findLive(q, c);
    if (live) {
      touched.add(live.id);
      if (live.origin !== "ai" || (live.status !== "suggested" && live.status !== "needs_review")) {
        result.kept++;
        continue;
      }
      if (live.evidence_signature === signature && live.evidence_current) {
        await q.query(`UPDATE water_opportunities SET refreshed_at = now() WHERE id = $1`, [live.id]);
        result.unchanged++;
        continue;
      }
      await q.query(
        `UPDATE water_opportunities SET reason = $2, evidence = $3, evidence_refs = $4, evidence_signature = $5, source = $6, potential = $7, confidence = $8,
                rule_key = $9, evidence_current = TRUE, refreshed_at = now(), updated_at = now() WHERE id = $1`,
        [live.id, d.reason, evidenceText(d.evidence_refs), JSON.stringify(d.evidence_refs), signature, sourcesText(d.evidence_refs), d.potential, d.confidence, d.rule_key],
      );
      await audit(q, actorId, "water_opportunity", live.id, "refresh", { rule: d.rule_key, evidence_signature: signature, potential: d.potential, confidence: d.confidence });
      result.refreshed++;
      continue;
    }
    const prior = (
      await q.query<{ id: number; status: string; evidence_signature: string | null; review_note: string | null; reviewed_at: string | null }>(
        `SELECT id, status, evidence_signature, review_note, reviewed_at FROM water_opportunities
          WHERE coalesce(project_id, 0) = $1 AND coalesce(organization_id, 0) = $2 AND intervention_type = $3 AND context_key = $4 AND status IN ('rejected', 'closed')
          ORDER BY coalesce(reviewed_at, updated_at) DESC, id DESC LIMIT 1`,
        [t.projectId ?? 0, t.organizationId ?? 0, d.intervention, d.context_key],
      )
    ).rows[0];
    if (prior && prior.evidence_signature === signature) {
      result.skipped_rejected++;
      continue;
    }
    const note = prior
      ? ` A previous ${d.intervention} opportunity here was ${prior.status}${prior.review_note ? ` (“${prior.review_note}”)` : ""}; this suggestion is based on changed evidence.`
      : "";
    const w = await suggestWaterOpportunity(q, { ...c, reason: d.reason + note, agent: WATER_AGENT, ruleKey: d.rule_key });
    touched.add(w.id);
    result.created++;
  }

  // Flag open AI suggestions on this target whose rule no longer fires.
  const { rows: stale } = await q.query<{ id: number; intervention_type: string; project_id: number | null; organization_id: number | null }>(
    `UPDATE water_opportunities SET evidence_current = FALSE, updated_at = now()
      WHERE coalesce(project_id, 0) = $1 AND coalesce(organization_id, 0) = $2 AND origin = 'ai' AND status IN ('suggested', 'needs_review')
        AND evidence_current AND NOT (id = ANY($3::int[]))
      RETURNING id, intervention_type, project_id, organization_id`,
    [t.projectId ?? 0, t.organizationId ?? 0, [...touched]],
  );
  for (const s of stale) {
    await audit(q, actorId, "water_opportunity", s.id, "evidence_no_longer_current", {});
    await logWater(q, s, "water_suggestion_stale", `Evidence for the suggested ${s.intervention_type} opportunity has changed; the suggestion no longer follows from current facts`, actorId, { water_opportunity_id: s.id });
  }
  result.stale = stale.length;

  if (result.created || result.refreshed || result.stale) {
    const parts = [result.created && `${result.created} new`, result.refreshed && `${result.refreshed} refreshed`, result.stale && `${result.stale} no longer supported`].filter(Boolean).join(", ");
    await logWater(q, { project_id: t.projectId ?? null, organization_id: t.organizationId ?? null }, "water_agent_run", `Water opportunity rules ran (${await userName(q, actorId)}): ${parts}`, actorId);
  }
  result.opportunities = t.projectId ? await listWaterOpportunities(q, { projectId: t.projectId }) : await listWaterOpportunities(q, { organizationId: t.organizationId, organizationLevelOnly: true });
  return result;
}

/* ------------------------------------------------------------------ counts */

/** Counts for the dashboard summary / daily brief. Real rows only — zero when there is nothing. */
export async function waterOpportunityCounts(q: Queryable, userId: number | null = null): Promise<WaterOpportunityCounts> {
  const { rows } = await q.query<WaterOpportunityCounts>(
    `SELECT
       count(*) FILTER (WHERE status IN ('suggested', 'needs_review'))::int AS "toReview",
       count(*) FILTER (WHERE status IN ('approved', 'converted') AND reviewed_at > now() - interval '7 days')::int AS "approvedLast7Days",
       count(*) FILTER (WHERE potential = 'High' AND status IN ('suggested', 'needs_review', 'approved'))::int AS "highPotentialOpen",
       count(*) FILTER (WHERE project_id IS NOT NULL AND status = 'approved')::int AS "projectAwaitingNextAction",
       count(*) FILTER (WHERE status = 'approved')::int AS "approvedNotConverted"
       FROM water_opportunities WHERE ($1::int IS NULL OR owner_id = $1 OR owner_id IS NULL)`,
    [userId],
  );
  return rows[0];
}
