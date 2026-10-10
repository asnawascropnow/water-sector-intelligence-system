import { Router } from "express";
import { db } from "../db";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import { audit } from "../lib/log";
import { todayIST } from "../lib/time";
import { geocoderEnabled } from "../lib/geocode";
import { llmEnabled, llmModel } from "../extraction/llm";
import { dailyBrief, listOpenRecommendations, refreshRecommendations } from "../agents/runner";
import { assessAndStore } from "../agents/opportunity";
import { getCatalog, organizationTaxonomy, waterInterventions } from "../lib/catalog";
import { waterOpportunityCounts } from "../lib/waterOpportunities";
import { crmPipelineCounts } from "../lib/crm";
import type { DashboardSummary, SystemInfo } from "../../shared/types";

export const usersRouter = Router();
export const dashboardRouter = Router();
export const aiRouter = Router();
export const systemRouter = Router();
export const metaRouter = Router();

/** Read-only catalogs: organization types, project types, roles, interventions, opportunity types, pipelines, fact definitions. */
metaRouter.get(
  "/",
  ah(async (_req, res) => {
    res.json(await getCatalog(db()));
  }),
);

/** Organization taxonomy: groups, types (with group, order, active state, map colour) and saved views. */
metaRouter.get(
  "/organization-types",
  ah(async (_req, res) => {
    res.json(await organizationTaxonomy(db()));
  }),
);

/** Water intervention catalog: stable key, label, group, description, active state, order. */
metaRouter.get(
  "/water-interventions",
  ah(async (_req, res) => {
    res.json(await waterInterventions(db()));
  }),
);

usersRouter.get(
  "/",
  ah(async (_req, res) => {
    res.json((await db().query(`SELECT id, name, email, role, active FROM users ORDER BY active DESC, name`)).rows);
  }),
);
usersRouter.post(
  "/",
  ah(async (req, res) => {
    const { name, email, role } = req.body ?? {};
    if (!name?.trim()) throw new HttpError(400, "Name is required");
    const { rows } = await db().query(`INSERT INTO users (name, email, role) VALUES ($1, $2, $3) RETURNING id, name, email, role, active`, [name.trim(), email?.trim() || null, role?.trim() || "member"]);
    await audit(db(), actorId(req), "user", rows[0].id, "create", req.body);
    res.status(201).json(rows[0]);
  }),
);
usersRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const { name, email, role, active } = req.body ?? {};
    const { rows } = await db().query(
      `UPDATE users SET name = coalesce($2, name), email = coalesce($3, email), role = coalesce($4, role), active = coalesce($5, active) WHERE id = $1 RETURNING id, name, email, role, active`,
      [id, name ?? null, email ?? null, role ?? null, typeof active === "boolean" ? active : null],
    );
    if (!rows[0]) throw new HttpError(404, "User not found");
    await audit(db(), actorId(req), "user", id, "update", req.body);
    res.json(rows[0]);
  }),
);

dashboardRouter.get(
  "/summary",
  ah(async (_req, res) => {
    const q = db();
    const { rows } = await q.query<Omit<DashboardSummary, "pipeline">>(
      `SELECT
         (SELECT count(*)::int FROM organizations WHERE merged_into IS NULL) AS "totalOrganizations",
         (SELECT count(*)::int FROM organizations WHERE merged_into IS NULL AND created_at > now() - interval '7 days') AS "newOrganizations",
         (SELECT count(*)::int FROM crm_opportunities) AS "crmOpportunities",
         (SELECT count(*)::int FROM crm_opportunities o JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status WHERE ps.kind = 'open') AS "activeOpportunities",
         (SELECT count(*)::int FROM crm_opportunities WHERE proposal_status IN ('Sent','Accepted','Rejected')) AS "proposalsSent",
         (SELECT count(*)::int FROM crm_opportunities o JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
           WHERE ps.milestone = 'pilot' OR o.pilot_status IN ('Planned','In Progress','Completed')) AS "pilots",
         (SELECT count(*)::int FROM tasks WHERE status = 'Pending' AND due_date < $1) AS "overdueFollowUps"`,
      [todayIST()],
    );
    const pipeline = (
      await q.query<{ pipeline: string; status: string; count: number }>(`SELECT pipeline, status, count(*)::int AS count FROM crm_opportunities GROUP BY pipeline, status ORDER BY pipeline, status`)
    ).rows;
    res.json({ ...rows[0], pipeline, pipelines: await crmPipelineCounts(q, todayIST()), water: await waterOpportunityCounts(q) });
  }),
);

aiRouter.get(
  "/daily-brief",
  ah(async (req, res) => {
    const user = req.query.user ? Number(req.query.user) : null;
    res.json(await dailyBrief(db(), user));
  }),
);
aiRouter.get(
  "/recommendations",
  ah(async (req, res) => {
    await refreshRecommendations(db());
    const user = req.query.user ? Number(req.query.user) : null;
    res.json(await listOpenRecommendations(db(), { userId: user, limit: Number(req.query.limit) || 100 }));
  }),
);
aiRouter.post(
  "/recommendations/:id/:decision",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const decision = req.params.decision;
    if (decision !== "done" && decision !== "dismissed") throw new HttpError(400, "Decision must be done or dismissed");
    await db().query(`UPDATE agent_recommendations SET status = $2, resolved_at = now() WHERE id = $1`, [id, decision]);
    await audit(db(), actorId(req), "agent_recommendation", id, decision);
    res.json({ ok: true });
  }),
);
/** Re-run the Opportunity Agent across every organization. */
aiRouter.post(
  "/assess-all",
  ah(async (_req, res) => {
    const { rows } = await db().query<{ id: number }>(`SELECT id FROM organizations WHERE merged_into IS NULL`);
    for (const r of rows) await assessAndStore(db(), r.id);
    await refreshRecommendations(db());
    res.json({ assessed: rows.length });
  }),
);

systemRouter.get(
  "/",
  ah(async (_req, res) => {
    const info: SystemInfo = {
      database: db().kind,
      geocoder: geocoderEnabled() ? "nominatim" : "none",
      llm: llmEnabled(),
      llmModel: llmEnabled() ? llmModel() : null,
      schemaVersion: (await db().query<{ v: string | null }>(`SELECT max(version) AS v FROM schema_migrations`)).rows[0]?.v ?? null,
    };
    res.json(info);
  }),
);
