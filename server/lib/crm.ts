import type { Queryable } from "../db";
import { PIPELINE_STAGES, type CrmStatus } from "../../shared/constants";

export const OPP_SELECT = `
  SELECT o.id, o.organization_id, org.name AS organization_name, org.org_type, org.area,
         org.intelligence->>'potential' AS potential,
         o.owner_id, u.name AS owner_name, o.status, o.contact_id, c.name AS contact_name,
         o.last_contact_at, o.next_follow_up, o.notes, o.call_status, o.proposal_status, o.proposal_sent_at, o.pilot_status,
         (SELECT max(a.occurred_at) FROM activities a WHERE a.opportunity_id = o.id) AS last_activity_at,
         o.created_at, o.updated_at
    FROM crm_opportunities o
    JOIN organizations org ON org.id = o.organization_id
    LEFT JOIN users u ON u.id = o.owner_id
    LEFT JOIN contacts c ON c.id = o.contact_id`;

/** Move forward in the pipeline only (never backwards, never out of an outcome stage automatically). */
export function advance(current: CrmStatus, target: CrmStatus): CrmStatus {
  const ci = PIPELINE_STAGES.indexOf(current as (typeof PIPELINE_STAGES)[number]);
  const ti = PIPELINE_STAGES.indexOf(target as (typeof PIPELINE_STAGES)[number]);
  if (ci === -1 || ti === -1) return current;
  return ti > ci ? target : current;
}

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
