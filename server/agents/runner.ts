import type { Queryable } from "../db";
import type { DailyBrief, Recommendation } from "../../shared/types";
import { todayIST } from "../lib/time";
import { importReviewRecommendations, nextActionRecommendations, opportunityRecommendations, waterRecommendations, type RecommendationDraft } from "./nextAction";
import { waterOpportunityCounts } from "../lib/waterOpportunities";
import { crmPipelineCounts } from "../lib/crm";

/**
 * Refresh stored recommendations: upsert current ones (keeping done/dismissed status), and close
 * open recommendations whose condition no longer holds.
 */
export async function refreshRecommendations(q: Queryable): Promise<void> {
  const drafts: RecommendationDraft[] = [
    ...(await nextActionRecommendations(q)),
    ...(await opportunityRecommendations(q)),
    ...(await importReviewRecommendations(q)),
    ...(await waterRecommendations(q)),
  ];
  const keys = drafts.map((d) => d.dedupe_key);
  for (const d of drafts) {
    await q.query(
      `INSERT INTO agent_recommendations (agent, dedupe_key, organization_id, opportunity_id, action_type, title, reason, priority, assigned_to, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (dedupe_key) DO UPDATE SET
         title = EXCLUDED.title, reason = EXCLUDED.reason, priority = EXCLUDED.priority,
         assigned_to = EXCLUDED.assigned_to, payload = EXCLUDED.payload, refreshed_at = now()`,
      [d.agent, d.dedupe_key, d.organization_id, d.opportunity_id, d.action_type, d.title, d.reason, d.priority, d.assigned_to, JSON.stringify(d.payload ?? {})],
    );
  }
  // Auto-resolve open recommendations that are no longer applicable (condition cleared).
  await q.query(
    `UPDATE agent_recommendations SET status = 'done', resolved_at = now()
      WHERE status = 'open' AND agent IN ('next_action', 'opportunity', 'import_review') AND NOT (dedupe_key = ANY($1::text[]))`,
    [keys],
  );
}

export const RECOMMENDATION_SELECT = `
  SELECT r.id, r.agent, r.organization_id, org.name AS organization_name, r.opportunity_id, r.action_type, r.title, r.reason,
         r.priority, r.assigned_to, u.name AS assigned_name, r.status, r.payload, r.created_at
    FROM agent_recommendations r
    LEFT JOIN organizations org ON org.id = r.organization_id
    LEFT JOIN users u ON u.id = r.assigned_to`;

export async function listOpenRecommendations(q: Queryable, opts: { userId?: number | null; limit?: number; excludeAgents?: string[] } = {}): Promise<Recommendation[]> {
  const { rows } = await q.query<Recommendation>(
    `${RECOMMENDATION_SELECT}
      WHERE r.status = 'open'
        AND ($1::int IS NULL OR r.assigned_to = $1 OR r.assigned_to IS NULL)
        AND NOT (r.agent = ANY($3::text[]))
      ORDER BY CASE r.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, r.created_at
      LIMIT $2`,
    [opts.userId ?? null, opts.limit ?? 100, opts.excludeAgents ?? ["enrichment"]],
  );
  return rows;
}

/** Agent 5 — Daily Reminder Agent: today's counts plus the prioritised recommendation list. */
export async function dailyBrief(q: Queryable, userId: number | null): Promise<DailyBrief> {
  await refreshRecommendations(q);
  const today = todayIST();
  const mine = `($2::int IS NULL OR assigned_to = $2)`;
  const one = async (sql: string, params: unknown[]) => (await q.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;
  const open = `EXISTS (SELECT 1 FROM pipeline_stages ps WHERE ps.pipeline = o.pipeline AND ps.name = o.status AND ps.kind = 'open')`;
  const counts = {
    followUpsDue: await one(`SELECT count(*)::int n FROM tasks WHERE status = 'Pending' AND task_type <> 'Call' AND due_date = $1 AND ${mine}`, [today, userId]),
    callsToday: await one(`SELECT count(*)::int n FROM tasks WHERE status = 'Pending' AND task_type = 'Call' AND due_date = $1 AND ${mine}`, [today, userId]),
    overdueFollowUps: await one(`SELECT count(*)::int n FROM tasks WHERE status = 'Pending' AND due_date < $1 AND ${mine}`, [today, userId]),
    proposalsAwaitingResponse: await one(`SELECT count(*)::int n FROM crm_opportunities o WHERE o.proposal_status = 'Sent' AND ${open} AND ($1::int IS NULL OR o.owner_id = $1)`, [userId]),
    // Opportunities still at the first stage of their pipeline (New / Identified).
    newOpportunities: await one(
      `SELECT count(*)::int n FROM crm_opportunities o
        WHERE o.status = (SELECT f.name FROM pipeline_stages f WHERE f.pipeline = o.pipeline ORDER BY f.sort_order LIMIT 1)
          AND ($1::int IS NULL OR o.owner_id = $1 OR o.owner_id IS NULL)`,
      [userId],
    ),
    unassignedOpportunities: await one(`SELECT count(*)::int n FROM crm_opportunities o WHERE o.owner_id IS NULL AND ${open}`, []),
    pendingImportRecords: await one(
      `SELECT count(*)::int n FROM imports i, jsonb_array_elements(i.records) r WHERE i.status = 'review' AND r->>'status' = 'pending'`,
      [],
    ),
  };
  return {
    date: today,
    counts,
    recommendations: await listOpenRecommendations(q, { userId, limit: 50 }),
    water: await waterOpportunityCounts(q, userId),
    pipelines: await crmPipelineCounts(q, today, userId),
  };
}
