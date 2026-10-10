import { Router } from "express";
import { db } from "../db";
import { CALL_STATUSES, INTERACTION_TYPES, PILOT_STATUSES, POTENTIAL_LEVELS, PROPOSAL_STATUSES, TASK_PRIORITIES, TASK_TYPES } from "../../shared/constants";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import { audit, logActivity } from "../lib/log";
import { advanceByMilestone, createCrmOpportunity, getCrmOpportunity, OPP_SELECT, pipelineStages, syncNextFollowUp, userName } from "../lib/crm";
import { listWaterOpportunities } from "../lib/waterOpportunities";
import { projectStakeholders } from "../lib/projects";
import { todayIST } from "../lib/time";

export const crmRouter = Router();

const getOpp = getCrmOpportunity;
const list = (v: unknown) =>
  typeof v === "string" && v.trim()
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

/**
 * CRM opportunities with combinable server-side filters (WSIS Phase 7):
 * pipeline, stage, owner, type, organization_id, project_id, potential, intervention, lifecycle (project
 * stage), open=1 (open stages only) and q — a search over organization, project, title, contact person and
 * linked water intervention. Without filters the result is every opportunity, as before.
 */
crmRouter.get(
  "/",
  ah(async (req, res) => {
    const qs = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: (n: number) => string, v: unknown) => {
      params.push(v);
      where.push(sql(params.length));
    };
    if (qs.owner) add((n) => `o.owner_id = $${n}`, intParam(qs.owner, "owner"));
    if (qs.pipeline) add((n) => `o.pipeline = $${n}`, qs.pipeline);
    if (qs.project_id) add((n) => `o.project_id = $${n}`, intParam(qs.project_id, "project_id"));
    if (qs.organization_id) add((n) => `o.organization_id = $${n}`, intParam(qs.organization_id, "organization_id"));
    if (list(qs.stage)) add((n) => `o.status = ANY($${n}::text[])`, list(qs.stage));
    if (list(qs.type)) add((n) => `o.opportunity_type = ANY($${n}::text[])`, list(qs.type));
    if (list(qs.potential)) add((n) => `coalesce(o.potential, org.intelligence->>'potential', 'Unknown') = ANY($${n}::text[])`, list(qs.potential));
    if (list(qs.lifecycle)) add((n) => `p.lifecycle_stage = ANY($${n}::text[])`, list(qs.lifecycle));
    if (list(qs.intervention)) add((n) => `EXISTS (SELECT 1 FROM water_opportunities w WHERE w.crm_opportunity_id = o.id AND w.intervention_type = ANY($${n}::text[]))`, list(qs.intervention));
    if (qs.open === "1" || qs.open === "true") where.push(`ps.kind = 'open'`);
    if (qs.q?.trim()) {
      add(
        (n) => `(lower(org.name) LIKE $${n} OR lower(coalesce(p.name, '')) LIKE $${n} OR lower(coalesce(o.title, '')) LIKE $${n} OR lower(coalesce(c.name, '')) LIKE $${n}
               OR EXISTS (SELECT 1 FROM contacts cc WHERE cc.organization_id = o.organization_id AND lower(cc.name) LIKE $${n})
               OR EXISTS (SELECT 1 FROM water_opportunities w WHERE w.crm_opportunity_id = o.id AND lower(w.intervention_type) LIKE $${n}))`,
        `%${qs.q.trim().toLowerCase()}%`,
      );
    }
    const { rows } = await db().query(`${OPP_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY o.updated_at DESC, o.id DESC LIMIT 2000`, params);
    res.json(rows);
  }),
);

/** Filter options for the CRM board: projects, types and water interventions that occur in a pipeline. */
crmRouter.get(
  "/facets",
  ah(async (req, res) => {
    const pipeline = typeof req.query.pipeline === "string" ? req.query.pipeline : null;
    const q = db();
    const [projects, types, interventions] = await Promise.all([
      q.query(
        `SELECT p.id, p.name, count(*)::int AS count FROM crm_opportunities o JOIN projects p ON p.id = o.project_id
          WHERE ($1::text IS NULL OR o.pipeline = $1) GROUP BY p.id, p.name ORDER BY p.name`,
        [pipeline],
      ),
      q.query(`SELECT DISTINCT opportunity_type AS name FROM crm_opportunities WHERE ($1::text IS NULL OR pipeline = $1) ORDER BY 1`, [pipeline]),
      q.query(
        `SELECT DISTINCT w.intervention_type AS name FROM water_opportunities w JOIN crm_opportunities o ON o.id = w.crm_opportunity_id
          WHERE ($1::text IS NULL OR o.pipeline = $1) ORDER BY 1`,
        [pipeline],
      ),
    ]);
    res.json({ projects: projects.rows, types: types.rows.map((r) => r.name), interventions: interventions.rows.map((r) => r.name) });
  }),
);

/** Map-ready CRM metadata: project opportunities at their project's location, relationships at the organization's. Not used by the map UI yet. */
crmRouter.get(
  "/map",
  ah(async (req, res) => {
    const pipeline = typeof req.query.pipeline === "string" ? req.query.pipeline : null;
    const { rows } = await db().query(
      `SELECT o.id, o.pipeline, o.status, ps.kind AS stage_kind, o.organization_id, org.name AS organization_name, o.project_id, p.name AS project_name,
              ST_Y(coalesce(p.geom, org.geom)::geometry) AS lat, ST_X(coalesce(p.geom, org.geom)::geometry) AS lng,
              CASE WHEN p.geom IS NOT NULL THEN 'project' ELSE 'organization' END AS located_by
         FROM crm_opportunities o JOIN organizations org ON org.id = o.organization_id
         JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
         LEFT JOIN projects p ON p.id = o.project_id
        WHERE coalesce(p.geom, org.geom) IS NOT NULL AND ($1::text IS NULL OR o.pipeline = $1) ORDER BY o.id`,
      [pipeline],
    );
    res.json(rows);
  }),
);

/**
 * Add an organization to the CRM (Organization → Opportunity).
 * Optional: opportunity_type (default Customer), pipeline (default: the type's pipeline), project_id, title,
 * status (default: the pipeline's first stage), potential. Project opportunities need a project and a
 * customer that is a stakeholder on it. Only a second *open* opportunity of the same type for the same
 * project is a conflict.
 */
crmRouter.post(
  "/",
  ah(async (req, res) => {
    const actor = actorId(req);
    const { organization_id, owner_id, notes, contact_id, opportunity_type, pipeline, project_id, title, status, potential } = req.body ?? {};
    const orgId = intParam(organization_id, "organization_id");
    const projectId = project_id == null || project_id === "" ? null : intParam(project_id, "project_id");
    const opp = await db().tx((q) =>
      createCrmOpportunity(
        q,
        { organizationId: orgId, ownerId: owner_id || null, notes, contactId: contact_id || null, opportunityType: opportunity_type, pipeline, projectId, title, status, potential },
        actor,
        req.body,
      ),
    );
    res.status(201).json(opp);
  }),
);

/**
 * Opportunity detail: the opportunity with its pipeline's stages, the organization (contacts, its other
 * opportunities as relationship context), the project (customer's role, other stakeholders), linked water
 * opportunities (intervention, reason, evidence, confidence, provenance), tasks and the timeline.
 */
crmRouter.get(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const q = db();
    const opportunity = await getOpp(q, id);
    const [stages, organization, contacts, others, activities, tasks, water] = await Promise.all([
      pipelineStages(q, opportunity.pipeline),
      q.query(
        `SELECT org.id, org.name, org.org_type, org.area, org.address, org.phone, org.email, org.website, org.data_confidence, org.field_sources,
                org.intelligence->>'potential' AS ai_potential, s.label AS source_label
           FROM organizations org LEFT JOIN sources s ON s.id = org.source_id WHERE org.id = $1`,
        [opportunity.organization_id],
      ),
      q.query(`SELECT id, organization_id, name, designation, phone, email, is_primary FROM contacts WHERE organization_id = $1 ORDER BY is_primary DESC, id`, [opportunity.organization_id]),
      q.query(`${OPP_SELECT} WHERE o.organization_id = $1 AND o.id <> $2 ORDER BY o.pipeline = 'relationship' DESC, o.created_at`, [opportunity.organization_id, id]),
      q.query(
        `SELECT a.id, a.organization_id, a.opportunity_id, a.project_id, a.type, a.summary, a.details, a.actor_id, u.name AS actor_name, a.occurred_at
           FROM activities a LEFT JOIN users u ON u.id = a.actor_id WHERE a.opportunity_id = $1 ORDER BY a.occurred_at DESC, a.id DESC`,
        [id],
      ),
      q.query(
        `SELECT t.*, org.name AS organization_name, u.name AS assigned_name, (t.status = 'Pending' AND t.due_date < $2) AS overdue,
                p.name AS project_name, o.pipeline AS opportunity_pipeline, o.opportunity_type, o.title AS opportunity_title
           FROM tasks t LEFT JOIN organizations org ON org.id = t.organization_id LEFT JOIN users u ON u.id = t.assigned_to
           LEFT JOIN crm_opportunities o ON o.id = t.opportunity_id LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.opportunity_id = $1 ORDER BY (t.status = 'Pending') DESC, t.due_date NULLS LAST`,
        [id, todayIST()],
      ),
      q.query<{ id: number }>(`SELECT id FROM water_opportunities WHERE crm_opportunity_id = $1 ORDER BY id`, [id]),
    ]);
    let project = null;
    let stakeholders: Awaited<ReturnType<typeof projectStakeholders>> = [];
    if (opportunity.project_id) {
      project = (
        await q.query(
          `SELECT id, name, project_type, lifecycle_stage, scale, area, unit_count, field_sources, merged_into FROM projects WHERE id = $1`,
          [opportunity.project_id],
        )
      ).rows[0] ?? null;
      stakeholders = await projectStakeholders(q, opportunity.project_id);
    }
    const waterIds = new Set(water.rows.map((r) => r.id));
    const water_opportunities = waterIds.size
      ? (await listWaterOpportunities(q, opportunity.project_id ? { projectId: opportunity.project_id } : { organizationId: opportunity.organization_id })).filter((w) => waterIds.has(w.id))
      : [];
    res.json({
      opportunity,
      stages,
      organization: organization.rows[0],
      contacts: contacts.rows,
      other_opportunities: others.rows,
      project,
      stakeholders,
      water_opportunities,
      tasks: tasks.rows,
      activities: activities.rows,
    });
  }),
);

/**
 * Update an opportunity. Stage changes (`status`, or `stage_step` +1 / -1 along the pipeline's main track)
 * are validated against the opportunity's own pipeline and recorded on the timeline. A person may move a
 * stage backwards; automatic movement (interactions, proposals, pilots) only ever moves forward.
 */
crmRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const actor = actorId(req);
    const b = { ...(req.body ?? {}) };
    const opp = await db().tx(async (q) => {
      const cur = await getOpp(q, id);
      const stages = await pipelineStages(q, cur.pipeline);
      const who = await userName(q, actor);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      const log = (type: string, summary: string, details: object = {}) =>
        logActivity(q, { organizationId: cur.organization_id, opportunityId: id, type, summary, details, actorId: actor });
      let status: string = cur.status;
      let statusSource: "manual" | "automatic" | null = null;

      if ("stage_step" in b) {
        const main = stages.filter((s) => !s.is_outcome);
        const i = main.findIndex((s) => s.name === cur.status);
        const step = Number(b.stage_step);
        if (i === -1) throw new HttpError(409, `"${cur.status}" is an outcome stage — choose a stage explicitly`);
        if (step !== 1 && step !== -1) throw new HttpError(400, "stage_step must be 1 or -1");
        const next = main[i + step];
        if (!next) throw new HttpError(409, step === 1 ? "Already at the last stage" : "Already at the first stage");
        b.status = next.name;
      }
      if ("status" in b && b.status !== cur.status) {
        if (!stages.some((s) => s.name === b.status)) {
          throw new HttpError(400, `"${b.status}" is not a stage of the ${cur.pipeline === "project" ? "Project Opportunity" : "Organization / Relationship"} pipeline`);
        }
        status = b.status;
        statusSource = "manual";
      }
      if ("owner_id" in b && (b.owner_id || null) !== cur.owner_id) {
        set("owner_id", b.owner_id || null);
        await log("assigned", b.owner_id ? `Assigned to ${await userName(q, b.owner_id)}` : `Owner removed by ${who}`);
      }
      if ("contact_id" in b && (b.contact_id || null) !== cur.contact_id) {
        if (b.contact_id) {
          const { rows } = await q.query<{ name: string }>(`SELECT name FROM contacts WHERE id = $1 AND organization_id = $2`, [b.contact_id, cur.organization_id]);
          if (!rows[0]) throw new HttpError(400, "Contact person must belong to the opportunity's organization");
          await log("contact_person", `Contact person set to ${rows[0].name}`);
        } else await log("contact_person", "Contact person cleared");
        set("contact_id", b.contact_id || null);
      }
      if ("potential" in b && (b.potential || null) !== (cur.potential_source === "team" ? cur.potential : null)) {
        if (b.potential && !POTENTIAL_LEVELS.includes(b.potential)) throw new HttpError(400, "Invalid potential");
        set("potential", b.potential || null);
        await log("potential", b.potential ? `Potential set to ${b.potential} by ${who}` : `Potential cleared by ${who}`);
      }
      if ("title" in b && (String(b.title ?? "").trim() || null) !== cur.title) {
        set("title", String(b.title ?? "").trim() || null);
        await log("title", `Title ${b.title ? `set to “${String(b.title).trim()}”` : "cleared"} by ${who}`);
      }
      if ("opportunity_type" in b && b.opportunity_type !== cur.opportunity_type) {
        const t = (await q.query<{ default_pipeline: string }>(`SELECT default_pipeline FROM opportunity_types WHERE name = $1 AND active`, [b.opportunity_type])).rows[0];
        if (!t) throw new HttpError(400, `Unknown opportunity type "${b.opportunity_type}"`);
        if (t.default_pipeline !== cur.pipeline) throw new HttpError(400, `"${b.opportunity_type}" does not belong to this opportunity's pipeline`);
        set("opportunity_type", b.opportunity_type);
        await log("opportunity_type", `Type changed: ${cur.opportunity_type} → ${b.opportunity_type}`);
      }
      if ("call_status" in b && b.call_status !== cur.call_status) {
        if (!CALL_STATUSES.includes(b.call_status)) throw new HttpError(400, "Unknown call status");
        set("call_status", b.call_status);
        await log("call_status", `Call status: ${cur.call_status} → ${b.call_status}`);
      }
      if ("proposal_status" in b && b.proposal_status !== cur.proposal_status) {
        if (!PROPOSAL_STATUSES.includes(b.proposal_status)) throw new HttpError(400, "Unknown proposal status");
        set("proposal_status", b.proposal_status);
        if (b.proposal_status === "Sent") {
          sets.push("proposal_sent_at = now()");
          if (!statusSource) {
            const s = advanceByMilestone(stages, status, "proposal");
            if (s !== status) [status, statusSource] = [s, "automatic"];
          }
        }
        await log(b.proposal_status === "Sent" ? "proposal_sent" : "proposal_status", `Proposal status: ${cur.proposal_status} → ${b.proposal_status}`);
      }
      if ("pilot_status" in b && b.pilot_status !== cur.pilot_status) {
        if (!PILOT_STATUSES.includes(b.pilot_status)) throw new HttpError(400, "Unknown pilot status");
        set("pilot_status", b.pilot_status);
        if (["Planned", "In Progress"].includes(b.pilot_status) && !statusSource) {
          const s = advanceByMilestone(stages, status, "pilot");
          if (s !== status) [status, statusSource] = [s, "automatic"];
        }
        await log("pilot_status", `${cur.project_id ? "Project pilot" : "Pilot"} status: ${cur.pilot_status} → ${b.pilot_status}`);
      }
      if ("notes" in b && (b.notes || null) !== cur.notes) {
        set("notes", b.notes || null);
        await log("notes_updated", `Opportunity notes updated by ${who}`, { notes: b.notes });
      }
      if (status !== cur.status) {
        set("status", status);
        await log(
          "status_change",
          `Status changed: ${cur.status} → ${status}${b.status_reason ? ` (${b.status_reason})` : ""}`,
          { from: cur.status, to: status, pipeline: cur.pipeline, ...(statusSource === "automatic" ? { automatic: true } : {}) },
        );
      }
      if (sets.length) {
        await q.query(`UPDATE crm_opportunities SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
        await audit(q, actor, "crm_opportunity", id, "update", req.body ?? {});
      }
      return getOpp(q, id);
    });
    res.json(opp);
  }),
);

/** Record an interaction (contact attempt, call, meeting, proposal, note) and optionally schedule a follow-up. */
crmRouter.post(
  "/:id/interactions",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const actor = actorId(req);
    const { type, note, occurred_at, follow_up } = req.body ?? {};
    const def = INTERACTION_TYPES.find((t) => t.type === type);
    if (!def) throw new HttpError(400, "Unknown interaction type");
    const opp = await db().tx(async (q) => {
      const cur = await getOpp(q, id);
      const stages = await pipelineStages(q, cur.pipeline);
      const who = await userName(q, actor);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      let status: string = cur.status;
      if (def.callStatus) set("call_status", def.callStatus);
      if (type !== "note") {
        params.push(occurred_at || new Date().toISOString());
        sets.push(`last_contact_at = $${params.length}::timestamptz`);
        status = advanceByMilestone(stages, status, "contacted");
      }
      if (def.milestone && def.milestone !== "contacted") status = advanceByMilestone(stages, status, def.milestone);
      if (type === "proposal_sent") {
        set("proposal_status", "Sent");
        sets.push("proposal_sent_at = now()");
      }
      if (status !== cur.status) set("status", status);
      await q.query(`UPDATE crm_opportunities SET ${sets.length ? sets.join(", ") + "," : ""} updated_at = now() WHERE id = $1`, params);
      await logActivity(q, {
        organizationId: cur.organization_id,
        opportunityId: id,
        type,
        summary: `${def.label}${note ? `: ${note}` : ""} — by ${who}`,
        details: { note: note || null },
        actorId: actor,
        occurredAt: occurred_at || null,
      });
      if (status !== cur.status) {
        await logActivity(q, { organizationId: cur.organization_id, opportunityId: id, type: "status_change", summary: `Status changed: ${cur.status} → ${status}`, details: { from: cur.status, to: status, pipeline: cur.pipeline, automatic: true }, actorId: actor });
      }
      if (follow_up?.due_date) {
        const taskType = TASK_TYPES.includes(follow_up.task_type) ? follow_up.task_type : type === "call_scheduled" ? "Call" : "Follow-up";
        const about = cur.project_name ? ` about ${cur.project_name}` : "";
        const title = follow_up.title?.trim() || (taskType === "Call" ? `Call ${cur.organization_name}${about}` : `Follow up with ${cur.organization_name}${about}`);
        const assignee = follow_up.assigned_to || cur.owner_id || actor;
        await q.query(
          `INSERT INTO tasks (organization_id, opportunity_id, project_id, assigned_to, title, task_type, due_date, priority, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [cur.organization_id, id, cur.project_id, assignee, title, taskType, follow_up.due_date, TASK_PRIORITIES.includes(follow_up.priority) ? follow_up.priority : "Medium", actor],
        );
        await logActivity(q, { organizationId: cur.organization_id, opportunityId: id, type: "follow_up_created", summary: `${taskType} scheduled for ${follow_up.due_date}: ${title} (assigned to ${await userName(q, assignee)})`, actorId: actor });
        await syncNextFollowUp(q, id);
      }
      await audit(q, actor, "crm_opportunity", id, "interaction", req.body);
      return getOpp(q, id);
    });
    res.status(201).json(opp);
  }),
);
