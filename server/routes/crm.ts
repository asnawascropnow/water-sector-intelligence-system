import { Router } from "express";
import { db, type Queryable } from "../db";
import { CALL_STATUSES, CRM_STATUSES, INTERACTION_TYPES, PILOT_STATUSES, PROPOSAL_STATUSES, TASK_PRIORITIES, TASK_TYPES, type CrmStatus } from "../../shared/constants";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import { audit, logActivity } from "../lib/log";
import { advance, OPP_SELECT, syncNextFollowUp, userName } from "../lib/crm";

export const crmRouter = Router();

async function getOpp(q: Queryable, id: number) {
  const { rows } = await q.query(`${OPP_SELECT} WHERE o.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Opportunity not found");
  return rows[0];
}

crmRouter.get(
  "/",
  ah(async (req, res) => {
    const owner = req.query.owner ? Number(req.query.owner) : null;
    const { rows } = await db().query(`${OPP_SELECT} WHERE ($1::int IS NULL OR o.owner_id = $1) ORDER BY o.updated_at DESC`, [owner]);
    res.json(rows);
  }),
);

/** Add an organization to the CRM (Organization → Opportunity). */
crmRouter.post(
  "/",
  ah(async (req, res) => {
    const actor = actorId(req);
    const { organization_id, owner_id, notes, contact_id } = req.body ?? {};
    const orgId = intParam(organization_id, "organization_id");
    const opp = await db().tx(async (q) => {
      const { rows: org } = await q.query<{ name: string; merged_into: number | null }>(`SELECT name, merged_into FROM organizations WHERE id = $1`, [orgId]);
      if (!org[0] || org[0].merged_into) throw new HttpError(404, "Organization not found");
      const { rows: ex } = await q.query(`SELECT id FROM crm_opportunities WHERE organization_id = $1`, [orgId]);
      if (ex[0]) throw new HttpError(409, "This organization is already in the CRM", { opportunity_id: ex[0].id });
      const { rows } = await q.query<{ id: number }>(
        `INSERT INTO crm_opportunities (organization_id, owner_id, notes, contact_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orgId, owner_id || null, notes || null, contact_id || null, actor],
      );
      const id = rows[0].id;
      const who = await userName(q, actor);
      await logActivity(q, { organizationId: orgId, opportunityId: id, type: "crm_added", summary: `Added to CRM by ${who}`, actorId: actor });
      if (owner_id) await logActivity(q, { organizationId: orgId, opportunityId: id, type: "assigned", summary: `Assigned to ${await userName(q, owner_id)}`, actorId: actor });
      await audit(q, actor, "crm_opportunity", id, "create", req.body);
      return getOpp(q, id);
    });
    res.status(201).json(opp);
  }),
);

crmRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const actor = actorId(req);
    const b = req.body ?? {};
    const opp = await db().tx(async (q) => {
      const cur = await getOpp(q, id);
      const who = await userName(q, actor);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      const log = (type: string, summary: string, details: object = {}) =>
        logActivity(q, { organizationId: cur.organization_id, opportunityId: id, type, summary, details, actorId: actor });

      if ("status" in b && b.status !== cur.status) {
        if (!CRM_STATUSES.includes(b.status)) throw new HttpError(400, "Unknown status");
        set("status", b.status);
        await log("status_change", `Status changed: ${cur.status} → ${b.status}${b.status_reason ? ` (${b.status_reason})` : ""}`, { from: cur.status, to: b.status });
      }
      if ("owner_id" in b && (b.owner_id || null) !== cur.owner_id) {
        set("owner_id", b.owner_id || null);
        await log("assigned", b.owner_id ? `Assigned to ${await userName(q, b.owner_id)}` : `Owner removed by ${who}`);
      }
      if ("contact_id" in b && (b.contact_id || null) !== cur.contact_id) {
        set("contact_id", b.contact_id || null);
        const { rows } = await q.query<{ name: string }>(`SELECT name FROM contacts WHERE id = $1`, [b.contact_id]);
        await log("contact_person", b.contact_id ? `Contact person set to ${rows[0]?.name}` : "Contact person cleared");
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
          if (!("status" in b)) set("status", advance(cur.status, "Proposal Sent"));
        }
        await log(b.proposal_status === "Sent" ? "proposal_sent" : "proposal_status", `Proposal status: ${cur.proposal_status} → ${b.proposal_status}`);
      }
      if ("pilot_status" in b && b.pilot_status !== cur.pilot_status) {
        if (!PILOT_STATUSES.includes(b.pilot_status)) throw new HttpError(400, "Unknown pilot status");
        set("pilot_status", b.pilot_status);
        if (["Planned", "In Progress"].includes(b.pilot_status) && !("status" in b)) set("status", advance(cur.status, "Pilot"));
        await log("pilot_status", `Pilot status: ${cur.pilot_status} → ${b.pilot_status}`);
      }
      if ("notes" in b && (b.notes || null) !== cur.notes) {
        set("notes", b.notes || null);
        await log("notes_updated", `Opportunity notes updated by ${who}`, { notes: b.notes });
      }
      if (sets.length) {
        await q.query(`UPDATE crm_opportunities SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
        await audit(q, actor, "crm_opportunity", id, "update", b);
      }
      return getOpp(q, id);
    });
    res.json(opp);
  }),
);

/** Record an interaction (contact attempt, call, proposal, note) and optionally schedule a follow-up. */
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
      const who = await userName(q, actor);
      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      let status: CrmStatus = cur.status;
      if (def.callStatus) set("call_status", def.callStatus);
      if (type !== "note") {
        params.push(occurred_at || new Date().toISOString());
        sets.push(`last_contact_at = $${params.length}::timestamptz`);
        status = advance(status, "Contacted");
      }
      if (type === "call_completed") status = advance(status, "Call");
      if (type === "proposal_sent") {
        set("proposal_status", "Sent");
        sets.push("proposal_sent_at = now()");
        status = advance(status, "Proposal Sent");
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
        await logActivity(q, { organizationId: cur.organization_id, opportunityId: id, type: "status_change", summary: `Status changed: ${cur.status} → ${status}`, details: { from: cur.status, to: status, automatic: true }, actorId: actor });
      }
      if (follow_up?.due_date) {
        const taskType = TASK_TYPES.includes(follow_up.task_type) ? follow_up.task_type : type === "call_scheduled" ? "Call" : "Follow-up";
        const title = follow_up.title?.trim() || (taskType === "Call" ? `Call ${cur.organization_name}` : `Follow up with ${cur.organization_name}`);
        const assignee = follow_up.assigned_to || cur.owner_id || actor;
        await q.query(
          `INSERT INTO tasks (organization_id, opportunity_id, assigned_to, title, task_type, due_date, priority, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [cur.organization_id, id, assignee, title, taskType, follow_up.due_date, TASK_PRIORITIES.includes(follow_up.priority) ? follow_up.priority : "Medium", actor],
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
