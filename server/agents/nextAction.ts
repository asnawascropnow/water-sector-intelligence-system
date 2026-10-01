import type { Queryable } from "../db";
import { daysSince, todayIST } from "../lib/time";

/**
 * Agent 4 — Next Action Agent. Looks at each open CRM opportunity and recommends one next step, with a reason.
 * Agent 3 output is also turned into "contact this organization" recommendations for high-potential organizations not yet in CRM.
 */

export interface RecommendationDraft {
  agent: "opportunity" | "next_action" | "import_review";
  dedupe_key: string;
  organization_id: number | null;
  opportunity_id: number | null;
  action_type: string;
  title: string;
  reason: string;
  priority: "High" | "Medium" | "Low";
  assigned_to: number | null;
  payload?: object;
}

interface OppRow {
  id: number;
  organization_id: number;
  name: string;
  status: string;
  owner_id: number | null;
  owner_name: string | null;
  call_status: string;
  proposal_status: string;
  proposal_sent_at: string | null;
  pilot_status: string;
  next_follow_up: string | null;
  last_contact_at: string | null;
  created_at: string;
  last_activity_at: string | null;
  last_activity_summary: string | null;
  pending_tasks: number;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export async function nextActionRecommendations(q: Queryable): Promise<RecommendationDraft[]> {
  const today = todayIST();
  const { rows } = await q.query<OppRow>(
    `SELECT o.id, o.organization_id, org.name, o.status, o.owner_id, u.name AS owner_name, o.call_status, o.proposal_status,
            o.proposal_sent_at, o.pilot_status, o.next_follow_up, o.last_contact_at, o.created_at,
            la.occurred_at AS last_activity_at, la.summary AS last_activity_summary,
            (SELECT count(*)::int FROM tasks t WHERE t.opportunity_id = o.id AND t.status = 'Pending') AS pending_tasks
       FROM crm_opportunities o
       JOIN organizations org ON org.id = o.organization_id
       LEFT JOIN users u ON u.id = o.owner_id
       LEFT JOIN LATERAL (SELECT occurred_at, summary FROM activities a WHERE a.opportunity_id = o.id ORDER BY occurred_at DESC LIMIT 1) la ON TRUE
      WHERE o.status NOT IN ('Converted', 'Not Interested', 'Lost') AND org.merged_into IS NULL`,
  );

  const recs: RecommendationDraft[] = [];
  for (const o of rows) {
    const base = { organization_id: o.organization_id, opportunity_id: o.id, assigned_to: o.owner_id, agent: "next_action" as const };
    const idle = daysSince(o.last_activity_at ?? o.created_at) ?? 0;
    const lastTxt = o.last_activity_at ? `Last activity ${idle === 0 ? "today" : `${plural(idle, "day")} ago`}${o.last_activity_summary ? ` (“${o.last_activity_summary}”)` : ""}.` : "No activity recorded yet.";
    const push = (action_type: string, title: string, reason: string, priority: RecommendationDraft["priority"]) =>
      recs.push({ ...base, dedupe_key: `next:${o.id}:${action_type}:${o.status}`, action_type, title, reason, priority });

    if (!o.owner_id) {
      push("assign_owner", `Assign ${o.name}`, `Opportunity has no owner. Nobody is responsible for the next step. Status: ${o.status}.`, "High");
    }

    if (o.next_follow_up && o.next_follow_up < today) {
      push("overdue_follow_up", `Follow up with ${o.name} (overdue)`, `Follow-up was due on ${o.next_follow_up} and has not been done. Status: ${o.status}. ${lastTxt}`, "High");
      continue;
    }

    if (o.status === "Nurture") {
      if (idle >= 30) push("re_engage", `Re-engage ${o.name}`, `In nurture with no activity for ${plural(idle, "day")}. A light check-in keeps the relationship warm.`, "Low");
      continue;
    }

    if (o.proposal_status === "Sent") {
      const since = daysSince(o.proposal_sent_at ?? o.last_activity_at) ?? idle;
      if (idle >= 5) {
        push("follow_up_proposal", `Follow up with ${o.name}`, `Proposal was sent ${plural(since, "day")} ago but no response has been recorded. ${lastTxt}`, since >= 10 ? "High" : "Medium");
        continue;
      }
    }

    if (o.pilot_status === "In Progress" && idle >= 14) {
      push("check_pilot", `Check pilot progress at ${o.name}`, `Pilot is in progress with no update for ${plural(idle, "day")}.`, "Medium");
      continue;
    }
    if (o.pilot_status === "Completed" && o.status !== "Converted") {
      push("close_pilot", `Discuss conversion with ${o.name}`, `Pilot is marked completed but the opportunity is not converted yet.`, "High");
      continue;
    }

    if (o.call_status === "Call Completed" && o.proposal_status === "Not Started") {
      push("send_proposal", `Send proposal to ${o.name}`, `Call was completed but no proposal has been started. ${lastTxt}`, idle >= 3 ? "High" : "Medium");
      continue;
    }
    if (o.call_status === "Call Scheduled" && o.pending_tasks === 0) {
      push("confirm_call", `Confirm call with ${o.name}`, `A call is marked as scheduled but there is no pending task tracking it.`, "Medium");
      continue;
    }
    if ((o.call_status === "No Response" || o.call_status === "Contact Attempted") && idle >= 3) {
      push("retry_contact", `Retry contact with ${o.name}`, `Last contact attempt got no response ${plural(idle, "day")} ago. Try a different channel or contact person.`, "Medium");
      continue;
    }
    if (o.call_status === "Connected" && idle >= 2) {
      push("schedule_call", `Schedule a call with ${o.name}`, `Contact was made ${plural(idle, "day")} ago but no call is scheduled yet.`, "Medium");
      continue;
    }
    if (o.status === "New" && o.call_status === "Not Started") {
      push("first_contact", `Contact ${o.name}`, `Added to CRM ${plural(daysSince(o.created_at) ?? 0, "day")} ago with no contact recorded yet.`, idle >= 3 ? "High" : "Medium");
      continue;
    }
    if (idle >= 10 && o.pending_tasks === 0) {
      push("stalled", `Review ${o.name}`, `No activity for ${plural(idle, "day")} and no pending follow-up. Status: ${o.status}. Decide next step or move to Nurture.`, "Medium");
    }
  }
  return recs;
}

export async function opportunityRecommendations(q: Queryable): Promise<RecommendationDraft[]> {
  const { rows } = await q.query<{ id: number; name: string; org_type: string; reasons: string[] | null; confidence: string | null }>(
    `SELECT org.id, org.name, org.org_type, org.intelligence->'reasons' AS reasons, org.intelligence->>'confidence' AS confidence
       FROM organizations org
      WHERE org.merged_into IS NULL
        AND org.intelligence->>'potential' = 'High'
        AND NOT EXISTS (SELECT 1 FROM crm_opportunities o WHERE o.organization_id = org.id)
      ORDER BY (org.intelligence->>'confidence' = 'High') DESC, org.updated_at DESC
      LIMIT 10`,
  );
  return rows.map((r) => ({
    agent: "opportunity",
    dedupe_key: `opp:${r.id}`,
    organization_id: r.id,
    opportunity_id: null,
    action_type: "add_to_crm",
    title: `Contact ${r.name}`,
    reason: `High-potential ${r.org_type.toLowerCase()} with no previous contact. ${(r.reasons ?? []).slice(0, 2).join(". ")}. Data confidence: ${r.confidence ?? "Unknown"} (AI Inference).`,
    priority: r.confidence === "High" ? "High" : "Medium",
    assigned_to: null,
  }));
}

export async function importReviewRecommendations(q: Queryable): Promise<RecommendationDraft[]> {
  const { rows } = await q.query<{ id: number; filename: string; pending: number; uploaded_by: number | null }>(
    `SELECT i.id, i.filename, i.uploaded_by,
            (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->>'status' = 'pending') AS pending
       FROM imports i WHERE i.status = 'review'`,
  );
  return rows
    .filter((r) => r.pending > 0)
    .map((r) => ({
      agent: "import_review",
      dedupe_key: `import:${r.id}`,
      organization_id: null,
      opportunity_id: null,
      action_type: "review_import",
      title: `Review ${plural(r.pending, "newly imported organization")}`,
      reason: `Import “${r.filename}” is waiting for review. Records are not added to the database until approved.`,
      priority: r.pending >= 20 ? "High" : "Medium",
      assigned_to: r.uploaded_by,
      payload: { import_id: r.id },
    }));
}
