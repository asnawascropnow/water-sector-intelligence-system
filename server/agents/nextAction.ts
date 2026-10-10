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
  pipeline: string;
  opportunity_type: string;
  title: string | null;
  project_id: number | null;
  project_name: string | null;
  stage_order: number;
  is_outcome: boolean;
  first_stage: boolean;
  proposal_order: number | null;
  contacted_order: number | null;
  won_stage: string | null;
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
  interventions: string[] | null;
  consultants: { role: string; name: string }[] | null;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * Next actions for every open opportunity in both pipelines. Stage logic comes from pipeline_stages
 * (kind, order, milestones), not stage names. Relationship opportunities keep the MVP wording; project
 * opportunities always name the project, so a project action never reads as an organization-level one.
 */
export async function nextActionRecommendations(q: Queryable): Promise<RecommendationDraft[]> {
  const today = todayIST();
  const { rows } = await q.query<OppRow>(
    `SELECT o.id, o.organization_id, org.name, o.status, o.pipeline, o.opportunity_type, o.title, o.project_id, p.name AS project_name,
            ps.sort_order AS stage_order, ps.is_outcome,
            ps.sort_order = (SELECT min(f.sort_order) FROM pipeline_stages f WHERE f.pipeline = o.pipeline) AS first_stage,
            (SELECT m.sort_order FROM pipeline_stages m WHERE m.pipeline = o.pipeline AND m.milestone = 'proposal') AS proposal_order,
            (SELECT m.sort_order FROM pipeline_stages m WHERE m.pipeline = o.pipeline AND m.milestone = 'contacted') AS contacted_order,
            (SELECT m.name FROM pipeline_stages m WHERE m.pipeline = o.pipeline AND m.kind = 'won' ORDER BY m.sort_order LIMIT 1) AS won_stage,
            o.owner_id, u.name AS owner_name, o.call_status, o.proposal_status,
            o.proposal_sent_at, o.pilot_status, o.next_follow_up, o.last_contact_at, o.created_at,
            la.occurred_at AS last_activity_at, la.summary AS last_activity_summary,
            (SELECT count(*)::int FROM tasks t WHERE t.opportunity_id = o.id AND t.status = 'Pending') AS pending_tasks,
            (SELECT array_agg(DISTINCT w.intervention_type) FROM water_opportunities w WHERE w.crm_opportunity_id = o.id) AS interventions,
            (SELECT json_agg(json_build_object('role', po.role, 'name', so.name) ORDER BY po.is_primary DESC, so.name)
               FROM project_organizations po JOIN organizations so ON so.id = po.organization_id
              WHERE po.project_id = o.project_id AND po.organization_id <> o.organization_id
                AND po.role IN ('MEP Consultant', 'Plumbing Consultant', 'Green Building Consultant')) AS consultants
       FROM crm_opportunities o
       JOIN organizations org ON org.id = o.organization_id
       JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
       LEFT JOIN projects p ON p.id = o.project_id
       LEFT JOIN users u ON u.id = o.owner_id
       LEFT JOIN LATERAL (SELECT occurred_at, summary FROM activities a WHERE a.opportunity_id = o.id ORDER BY occurred_at DESC LIMIT 1) la ON TRUE
      WHERE ps.kind = 'open' AND org.merged_into IS NULL AND (p.id IS NULL OR p.merged_into IS NULL)`,
  );

  const recs: RecommendationDraft[] = [];
  for (const raw of rows) {
    const project = raw.pipeline === "project" && raw.project_name ? raw.project_name : null;
    // An organization can hold several relationship opportunities: name the non-default ones so their actions are distinguishable
    // (the MVP's Customer opportunity keeps its exact wording).
    const o = !project && (raw.opportunity_type !== "Customer" || raw.title) ? { ...raw, name: `${raw.name} (${raw.title ?? raw.opportunity_type})` } : raw;
    const base = { organization_id: o.organization_id, opportunity_id: o.id, assigned_to: o.owner_id, agent: "next_action" as const, payload: project ? { project_id: o.project_id, pipeline: o.pipeline } : {} };
    const idle = daysSince(o.last_activity_at ?? o.created_at) ?? 0;
    const lastTxt = o.last_activity_at ? `Last activity ${idle === 0 ? "today" : `${plural(idle, "day")} ago`}${o.last_activity_summary ? ` (“${o.last_activity_summary}”)` : ""}.` : "No activity recorded yet.";
    const about = project ? ` about ${project}` : "";
    const topic = o.interventions?.length ? `the ${o.interventions.join(" / ")} discussion` : "the water discussion";
    const ctx = project ? ` Project opportunity: ${project} (customer ${o.name}).` : "";
    const push = (action_type: string, title: string, reason: string, priority: RecommendationDraft["priority"]) =>
      recs.push({ ...base, dedupe_key: `next:${o.id}:${action_type}:${o.status}`, action_type, title, reason: reason + ctx, priority });

    if (!o.owner_id) {
      push("assign_owner", project ? `Assign the ${project} opportunity with ${o.name}` : `Assign ${o.name}`, `Opportunity has no owner. Nobody is responsible for the next step. Status: ${o.status}.`, "High");
    }

    if (o.next_follow_up && o.next_follow_up < today) {
      push("overdue_follow_up", `Follow up with ${o.name}${about} (overdue)`, `Follow-up was due on ${o.next_follow_up} and has not been done. Status: ${o.status}. ${lastTxt}`, "High");
      continue;
    }

    if (o.is_outcome) {
      if (idle >= 30) push("re_engage", `Re-engage ${o.name}${about}`, `In ${o.status.toLowerCase()} with no activity for ${plural(idle, "day")}. A light check-in keeps the relationship warm.`, "Low");
      continue;
    }

    if (o.proposal_status === "Sent") {
      const since = daysSince(o.proposal_sent_at ?? o.last_activity_at) ?? idle;
      if (idle >= 5) {
        push(
          "follow_up_proposal",
          project ? `Follow up on the ${project} proposal with ${o.name}` : `Follow up with ${o.name}`,
          `Proposal was sent ${plural(since, "day")} ago but no response has been recorded. ${lastTxt}`,
          since >= 10 ? "High" : "Medium",
        );
        continue;
      }
    }

    if (o.pilot_status === "In Progress" && idle >= 14) {
      push("check_pilot", project ? `Check the ${project} pilot with ${o.name}` : `Check pilot progress at ${o.name}`, `${project ? "Project pilot" : "Pilot"} is in progress with no update for ${plural(idle, "day")}.`, "Medium");
      continue;
    }
    if (o.pilot_status === "Completed") {
      push(
        "close_pilot",
        project ? `Discuss the ${project} award with ${o.name}` : `Discuss conversion with ${o.name}`,
        `${project ? "Project pilot" : "Pilot"} is marked completed but the opportunity is not ${o.won_stage ? `at “${o.won_stage}”` : "won"} yet.`,
        "High",
      );
      continue;
    }

    if (o.call_status === "Call Completed" && o.proposal_status === "Not Started") {
      push("send_proposal", project ? `Send the ${project} proposal to ${o.name}` : `Send proposal to ${o.name}`, `Call was completed but no proposal has been started. ${lastTxt}`, idle >= 3 ? "High" : "Medium");
      continue;
    }
    if (o.call_status === "Call Scheduled" && o.pending_tasks === 0) {
      push("confirm_call", `Confirm call with ${o.name}${about}`, `A call is marked as scheduled but there is no pending task tracking it.`, "Medium");
      continue;
    }
    if ((o.call_status === "No Response" || o.call_status === "Contact Attempted") && idle >= 3) {
      push("retry_contact", `Retry contact with ${o.name}${about}`, `Last contact attempt got no response ${plural(idle, "day")} ago. Try a different channel or contact person.`, "Medium");
      continue;
    }
    if (o.call_status === "Connected" && idle >= 2) {
      push(project ? "schedule_meeting" : "schedule_call", project ? `Schedule a meeting with ${o.name} about ${project}` : `Schedule a call with ${o.name}`, `Contact was made ${plural(idle, "day")} ago but no ${project ? "meeting" : "call"} is scheduled yet.`, "Medium");
      continue;
    }
    if (o.first_stage && o.call_status === "Not Started") {
      push("first_contact", `Contact ${o.name}${about}`, `Added to CRM ${plural(daysSince(o.created_at) ?? 0, "day")} ago with no contact recorded yet.`, idle >= 3 ? "High" : "Medium");
      continue;
    }
    // Project: in technical discussion (after first contact, before the proposal) and quiet — involve the project's consultants.
    const midStream = o.contacted_order != null && o.proposal_order != null && o.stage_order > o.contacted_order && o.stage_order < o.proposal_order;
    if (project && midStream && idle >= 7 && o.consultants?.length) {
      const c = o.consultants[0];
      push(
        "contact_consultant",
        `Contact the ${c.role} (${c.name}) about ${topic} for ${project}`,
        `${o.status} with ${o.name} has been quiet for ${plural(idle, "day")}. ${c.name} is the project's ${c.role} and is likely to shape the water design.`,
        "Medium",
      );
      continue;
    }
    if (idle >= 10 && o.pending_tasks === 0) {
      push("stalled", `Review ${o.name}${about}`, `No activity for ${plural(idle, "day")} and no pending follow-up. Status: ${o.status}. Decide next step or move to Nurture.`, "Medium");
    }
  }
  return recs;
}

/** One short sentence: why this organization is worth contacting. */
function opportunityReason(r: { org_type: string; reasons: string[] | null; confidence: string | null }) {
  const first = r.reasons?.[0] ?? "";
  const why = (first.includes(" — ") ? first.split(" — ")[1] : first).replace(/\s*\(type inferred from name\)/, "");
  const sentence = why ? why[0].toUpperCase() + why.slice(1).replace(/\.?$/, ".") : "";
  return `${r.org_type} with no contact yet. ${sentence} Confidence: ${r.confidence ?? "Unknown"} (AI Inference).`.replace(/\s+/g, " ");
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
    reason: opportunityReason(r),
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

/**
 * Opportunity Agent — water opportunity follow-ups (WSIS Phase 6). Reads existing water opportunities only;
 * it never creates or approves one:
 * - suggestions waiting for a person to review them, grouped per project / organization;
 * - approved opportunities not yet linked to the CRM, naming the project's stakeholders (and whether each
 *   is already in the CRM) as people to approach — without implying the opportunity is theirs.
 */
export async function waterRecommendations(q: Queryable): Promise<RecommendationDraft[]> {
  const recs: RecommendationDraft[] = [];
  const { rows: pending } = await q.query<{ project_id: number | null; organization_id: number | null; target: string; n: number; interventions: string[]; high: boolean; owner: number | null }>(
    `SELECT w.project_id, CASE WHEN w.project_id IS NULL THEN w.organization_id END AS organization_id,
            coalesce(p.name, org.name) AS target, count(*)::int AS n,
            array_agg(w.intervention_type ORDER BY w.potential = 'High' DESC, w.id) AS interventions,
            bool_or(w.potential = 'High') AS high, min(w.owner_id) AS owner
       FROM water_opportunities w LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN organizations org ON org.id = w.organization_id
      WHERE w.status IN ('suggested', 'needs_review') AND (p.id IS NULL OR p.merged_into IS NULL) AND (org.id IS NULL OR org.merged_into IS NULL)
      GROUP BY w.project_id, CASE WHEN w.project_id IS NULL THEN w.organization_id END, coalesce(p.name, org.name)`,
  );
  for (const r of pending) {
    const list = r.interventions.slice(0, 3).join(", ") + (r.interventions.length > 3 ? ` and ${r.interventions.length - 3} more` : "");
    recs.push({
      agent: "opportunity",
      dedupe_key: r.project_id ? `water-review:p:${r.project_id}` : `water-review:o:${r.organization_id}`,
      organization_id: r.organization_id,
      opportunity_id: null,
      action_type: "review_water_suggestions",
      title: `Review ${plural(r.n, "water opportunity suggestion")} for ${r.target}`,
      reason: `${list}. These are AI Inference from the recorded facts and need a person to approve or reject them before they are treated as opportunities.`,
      priority: r.high ? "High" : "Medium",
      assigned_to: r.owner,
      payload: r.project_id ? { project_id: r.project_id } : {},
    });
  }

  const { rows: approved } = await q.query<{
    id: number; intervention_type: string; potential: string; project_id: number | null; organization_id: number | null; target: string;
    owner_id: number | null; reviewer: string | null; reviewed_at: string | null; stakeholders: { role: string; name: string; crm_status: string | null }[] | null;
  }>(
    `SELECT w.id, w.intervention_type, w.potential, w.project_id, w.organization_id, coalesce(p.name, org.name) AS target, w.owner_id,
            ru.name AS reviewer, w.reviewed_at,
            (SELECT json_agg(json_build_object('role', po.role, 'name', so.name,
                    'crm_status', (SELECT c.status FROM crm_opportunities c JOIN pipeline_stages ps ON ps.pipeline = c.pipeline AND ps.name = c.status
                                    WHERE c.organization_id = so.id AND c.pipeline = 'relationship' AND ps.kind = 'open' ORDER BY c.created_at LIMIT 1))
                    ORDER BY po.is_primary DESC, po.role, so.name)
               FROM project_organizations po JOIN organizations so ON so.id = po.organization_id WHERE po.project_id = w.project_id) AS stakeholders
       FROM water_opportunities w LEFT JOIN projects p ON p.id = w.project_id LEFT JOIN organizations org ON org.id = w.organization_id
       LEFT JOIN users ru ON ru.id = w.reviewed_by
      WHERE w.status = 'approved' AND w.crm_opportunity_id IS NULL AND (p.id IS NULL OR p.merged_into IS NULL) AND (org.id IS NULL OR org.merged_into IS NULL)`,
  );
  for (const w of approved) {
    let who = "";
    if (w.project_id) {
      const s = (w.stakeholders ?? []).slice(0, 4).map((x) => `${x.role}: ${x.name}${x.crm_status ? ` (already in CRM — ${x.crm_status})` : ""}`);
      who = s.length ? ` Stakeholders on the project: ${s.join("; ")}.` : " No stakeholder organization is linked to the project yet — link one before creating a CRM opportunity.";
    }
    recs.push({
      agent: "opportunity",
      dedupe_key: `water-convert:${w.id}`,
      organization_id: w.project_id ? null : w.organization_id,
      opportunity_id: null,
      action_type: "convert_water_opportunity",
      title: `Decide the next step for ${w.intervention_type} at ${w.target}`,
      reason: `Approved${w.reviewer ? ` by ${w.reviewer}` : ""}${w.reviewed_at ? ` ${plural(daysSince(w.reviewed_at) ?? 0, "day")} ago` : ""} and not yet linked to a CRM opportunity.${who}`,
      priority: w.potential === "High" ? "High" : "Medium",
      assigned_to: w.owner_id,
      payload: w.project_id ? { project_id: w.project_id, water_opportunity_id: w.id } : { water_opportunity_id: w.id },
    });
  }
  return recs;
}
