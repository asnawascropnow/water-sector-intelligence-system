import { Router, type Request } from "express";
import { db } from "../db";
import type { ProjectInput } from "../../shared/types";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import { createSource } from "../lib/log";
import { userName } from "../lib/crm";
import { OPP_SELECT } from "../lib/crm";
import { addFact, changeFact, listFacts, retireFact } from "../lib/facts";
import { findProjectDuplicates } from "../lib/projectDuplicates";
import { listWaterOpportunities } from "../lib/waterOpportunities";
import {
  addStakeholder,
  createProject,
  getProject,
  listProjects,
  mergeProject,
  normalizeProject,
  projectStakeholders,
  removeStakeholder,
  updateProject,
  updateStakeholder,
} from "../lib/projects";

/**
 * Projects API (WSIS Phase 4). Same conventions as /api/organizations:
 * - the acting user comes from X-User-Id; errors are { error } with 400/404/409;
 * - new records are duplicate-checked and return 409 { duplicate } unless the caller chose force;
 * - nothing is merged automatically; merging is an explicit human action.
 */
export const projectsRouter = Router();

const list = (v: unknown) =>
  typeof v === "string" && v.trim()
    ? v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

projectsRouter.get(
  "/",
  ah(async (req, res) => {
    const qs = req.query as Record<string, string | undefined>;
    let near: { lat: number; lng: number; radiusM: number } | undefined;
    if (qs.near) {
      const [lat, lng] = qs.near.split(",").map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new HttpError(400, "near must be \"lat,lng\"");
      const radiusM = qs.radius ? Number(qs.radius) : 2000;
      if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 50000) throw new HttpError(400, "radius must be between 1 and 50000 metres");
      near = { lat, lng, radiusM };
    }
    const organizationId = qs.organization_id ? intParam(qs.organization_id, "organization_id") : undefined;
    res.json(
      await listProjects(db(), {
        q: qs.q,
        stages: list(qs.stage),
        types: list(qs.type),
        scales: list(qs.scale),
        area: qs.area,
        pincode: qs.pincode,
        organizationId,
        role: qs.role,
        near,
        limit: qs.limit ? Number(qs.limit) : undefined,
      }),
    );
  }),
);

/** Filter options for the Projects page: areas and stakeholder organizations that occur on projects. */
projectsRouter.get(
  "/facets",
  ah(async (_req, res) => {
    const q = db();
    const areas = (await q.query<{ area: string }>(`SELECT DISTINCT area FROM projects WHERE area IS NOT NULL AND merged_into IS NULL ORDER BY area`)).rows.map((r) => r.area);
    const organizations = (
      await q.query<{ id: number; name: string; org_type: string; project_count: number }>(
        `SELECT o.id, o.name, o.org_type, count(DISTINCT po.project_id)::int AS project_count
           FROM project_organizations po JOIN organizations o ON o.id = po.organization_id JOIN projects p ON p.id = po.project_id
          WHERE p.merged_into IS NULL AND o.merged_into IS NULL
          GROUP BY o.id, o.name, o.org_type ORDER BY o.name`,
      )
    ).rows;
    res.json({ areas, organizations });
  }),
);

projectsRouter.post(
  "/check-duplicates",
  ah(async (req, res) => {
    const body = (req.body ?? {}) as ProjectInput & { exclude_id?: number };
    const { data } = await normalizeProject(db(), body, "check");
    res.json(await findProjectDuplicates(db(), data, body.exclude_id ?? null));
  }),
);

/** Create a project. Possible duplicates → 409 { duplicate } unless `force: true` ("keep separate"). */
projectsRouter.post(
  "/",
  ah(async (req, res) => {
    const actor = actorId(req);
    const { data, force, provenance } = (req.body ?? {}) as { data?: ProjectInput; force?: boolean; provenance?: "Verified" | "Unverified" };
    if (!data || typeof data !== "object") throw new HttpError(400, "data is required");
    const who = await userName(db(), actor);
    const label = `Manual entry by ${who}`;
    const project = await db().tx(async (q) => {
      const { data: norm } = await normalizeProject(q, data, label);
      if (!force) {
        const dup = await findProjectDuplicates(q, norm);
        if (dup.level !== "new") throw new HttpError(409, "Possible duplicate project found", { duplicate: dup });
      }
      const sourceId = await createSource(q, { kind: "manual", label, createdBy: actor });
      return createProject(q, data, { sourceId, sourceLabel: label, provenance: provenance === "Verified" ? "Verified" : "Unverified", actorId: actor });
    });
    res.status(201).json(project);
  }),
);

async function loadProject(req: Request) {
  const id = intParam(req.params.id);
  const p = await getProject(db(), id);
  if (!p) throw new HttpError(404, "Project not found");
  return p;
}

projectsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const project = await loadProject(req);
    if (project.merged_into) return res.json({ merged_into: project.merged_into });
    const q = db();
    const [stakeholders, facts, crm, water] = await Promise.all([
      projectStakeholders(q, project.id),
      listFacts(q, "project", project.id),
      q.query(`${OPP_SELECT} WHERE o.project_id = $1 ORDER BY o.created_at`, [project.id]),
      listWaterOpportunities(q, { projectId: project.id }),
    ]);
    res.json({ project, stakeholders, facts, crm_opportunities: crm.rows, water_opportunities: water });
  }),
);

projectsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const actor = actorId(req);
    const who = await userName(db(), actor);
    res.json(await db().tx((q) => updateProject(q, id, req.body ?? {}, actor, who)));
  }),
);

/** Merge this (duplicate) project into another. Human decision only. */
projectsRouter.post(
  "/:id/merge-into/:targetId",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const targetId = intParam(req.params.targetId, "target id");
    res.json(await db().tx((q) => mergeProject(q, id, targetId, actorId(req))));
  }),
);

/* ---------------- Stakeholders ---------------- */

projectsRouter.get(
  "/:id/stakeholders",
  ah(async (req, res) => {
    const p = await loadProject(req);
    res.json(await projectStakeholders(db(), p.id));
  }),
);

projectsRouter.post(
  "/:id/stakeholders",
  ah(async (req, res) => {
    const projectId = intParam(req.params.id);
    const b = req.body ?? {};
    const organizationId = intParam(b.organization_id, "organization_id");
    if (!b.role) throw new HttpError(400, "role is required");
    const link = await db().tx((q) =>
      addStakeholder(
        q,
        {
          projectId,
          organizationId,
          role: String(b.role),
          isPrimary: Boolean(b.is_primary),
          provenance: b.provenance ?? "Unverified",
          confidence: b.confidence,
          source: b.source,
          notes: b.notes,
        },
        actorId(req),
      ),
    );
    res.status(201).json(link);
  }),
);

projectsRouter.patch(
  "/:id/stakeholders/:linkId",
  ah(async (req, res) => {
    const b = req.body ?? {};
    const link = await db().tx((q) =>
      updateStakeholder(
        q,
        intParam(req.params.id),
        intParam(req.params.linkId, "link id"),
        { role: b.role, isPrimary: b.is_primary, notes: b.notes, source: b.source, provenance: b.provenance, confidence: b.confidence },
        actorId(req),
      ),
    );
    res.json(link);
  }),
);

projectsRouter.delete(
  "/:id/stakeholders/:linkId",
  ah(async (req, res) => {
    await db().tx((q) => removeStakeholder(q, intParam(req.params.id), intParam(req.params.linkId, "link id"), actorId(req), (req.body ?? {}).reason));
    res.status(204).end();
  }),
);

/* ---------------- Facts ---------------- */

projectsRouter.get(
  "/:id/facts",
  ah(async (req, res) => {
    const p = await loadProject(req);
    res.json(await listFacts(db(), "project", p.id, { includeRetired: req.query.include_retired === "1" || req.query.include_retired === "true" }));
  }),
);

projectsRouter.post(
  "/:id/facts",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body ?? {};
    if (!b.key) throw new HttpError(400, "key is required");
    const r = await db().tx((q) =>
      addFact(q, "project", id, { key: String(b.key), value: b.value, provenance: b.provenance, confidence: b.confidence, source: b.source, note: b.note }, actorId(req)),
    );
    res.status(201).json(r);
  }),
);

/** Change a fact: the current version is retired and a new version is created (history kept). */
projectsRouter.patch(
  "/:id/facts/:factId",
  ah(async (req, res) => {
    const b = req.body ?? {};
    const r = await db().tx((q) =>
      changeFact(q, "project", intParam(req.params.id), intParam(req.params.factId, "fact id"), { value: b.value, provenance: b.provenance, confidence: b.confidence, source: b.source, note: b.note }, actorId(req)),
    );
    res.json(r);
  }),
);

/** Withdraw a fact (kept for history). */
projectsRouter.delete(
  "/:id/facts/:factId",
  ah(async (req, res) => {
    const projectId = intParam(req.params.id);
    const factId = intParam(req.params.factId, "fact id");
    await db().tx(async (q) => {
      const own = await q.query(`SELECT 1 FROM project_facts WHERE id = $1 AND project_id = $2`, [factId, projectId]);
      if (!own.rows.length) throw new HttpError(404, "Fact not found");
      await retireFact(q, "project", factId, actorId(req));
    });
    res.status(204).end();
  }),
);

/**
 * Project timeline: project_activities (create, edits, stakeholders, facts, water opportunities, merges) plus
 * organization activities that carry this project (CRM work on its project opportunities), newest first.
 */
projectsRouter.get(
  "/:id/activity",
  ah(async (req, res) => {
    const p = await loadProject(req);
    const { rows } = await db().query(
      `SELECT * FROM (
         SELECT 'p' || pa.id AS key, pa.id, pa.type, pa.summary, pa.details, pa.actor_id, u.name AS actor_name, pa.occurred_at, NULL::int AS organization_id
           FROM project_activities pa LEFT JOIN users u ON u.id = pa.actor_id WHERE pa.project_id = $1
         UNION ALL
         SELECT 'a' || a.id, a.id, a.type, org.name || ': ' || a.summary, a.details, a.actor_id, u.name, a.occurred_at, a.organization_id
           FROM activities a JOIN organizations org ON org.id = a.organization_id
           LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.project_id = $1
       ) t ORDER BY occurred_at DESC, key DESC LIMIT 500`,
      [p.id],
    );
    res.json(rows);
  }),
);
