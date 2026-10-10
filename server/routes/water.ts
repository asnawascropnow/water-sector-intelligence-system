import { Router } from "express";
import { db } from "../db";
import { WATER_OPPORTUNITY_STATUSES, type WaterOpportunityStatus } from "../../shared/constants";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import {
  changeWaterStatus,
  convertWaterOpportunity,
  createWaterOpportunity,
  generateWaterOpportunities,
  getWaterOpportunity,
  listWaterOpportunities,
  reviewWaterOpportunity,
  startReview,
  updateWaterOpportunity,
  waterOpportunityHistory,
} from "../lib/waterOpportunities";

/**
 * Water opportunities API (WSIS Phase 6). Every write is a named person's action (X-User-Id):
 * generating suggestions, reviewing, approving / rejecting, assigning, closing and converting to CRM.
 * Suggestions are AI Inference until a person approves them; nothing is deleted.
 */
export const waterRouter = Router();

const optInt = (v: unknown, name: string) => (v == null || v === "" ? undefined : intParam(v, name));

waterRouter.get(
  "/",
  ah(async (req, res) => {
    const qs = req.query as Record<string, string | undefined>;
    const statuses = qs.status ? qs.status.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    if (statuses?.some((s) => !WATER_OPPORTUNITY_STATUSES.includes(s as WaterOpportunityStatus))) throw new HttpError(400, "Unknown status");
    res.json(
      await listWaterOpportunities(db(), {
        projectId: optInt(qs.project_id, "project_id"),
        organizationId: optInt(qs.organization_id, "organization_id"),
        organizationLevelOnly: qs.level === "organization",
        statuses,
      }),
    );
  }),
);

/**
 * Map-ready metadata for trusted (approved / converted) opportunities, located by their project or
 * organization. Prepared for a later map layer; the map UI does not use it yet.
 */
waterRouter.get(
  "/map",
  ah(async (_req, res) => {
    const { rows } = await db().query(
      `SELECT w.id, w.intervention_type, w.potential, w.status, w.project_id, w.organization_id,
              coalesce(p.name, org.name) AS name,
              ST_Y(coalesce(p.geom, org.geom)::geometry) AS lat, ST_X(coalesce(p.geom, org.geom)::geometry) AS lng
         FROM water_opportunities w LEFT JOIN projects p ON p.id = w.project_id
         LEFT JOIN organizations org ON org.id = w.organization_id AND w.project_id IS NULL
        WHERE w.status IN ('approved', 'converted') AND coalesce(p.geom, org.geom) IS NOT NULL
        ORDER BY w.id`,
    );
    res.json(rows);
  }),
);

/** Run the water opportunity rules for one project or organization (a person's explicit action). */
waterRouter.post(
  "/generate",
  ah(async (req, res) => {
    const b = req.body ?? {};
    const projectId = optInt(b.project_id, "project_id");
    const organizationId = optInt(b.organization_id, "organization_id");
    if (!projectId === !organizationId) throw new HttpError(400, "Give either project_id or organization_id");
    res.json(await db().tx((q) => generateWaterOpportunities(q, { projectId, organizationId }, actorId(req))));
  }),
);

/** Record an opportunity a person identified (approved on entry, with that person as reviewer). */
waterRouter.post(
  "/",
  ah(async (req, res) => {
    const b = req.body ?? {};
    const actor = actorId(req);
    if (!actor) throw new HttpError(400, "A person must create manual water opportunities");
    const w = await db().tx((q) =>
      createWaterOpportunity(
        q,
        {
          projectId: optInt(b.project_id, "project_id") ?? null,
          organizationId: optInt(b.organization_id, "organization_id") ?? null,
          interventionType: String(b.intervention_type ?? ""),
          contextKey: b.context_key,
          potential: b.potential,
          reason: String(b.reason ?? ""),
          evidence: b.evidence,
          source: b.source,
          provenance: b.provenance ?? "Unverified",
          confidence: b.confidence,
          ownerId: b.owner_id || null,
        },
        actor,
      ),
    );
    res.status(201).json(w);
  }),
);

waterRouter.get(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const [opportunity, history] = await Promise.all([getWaterOpportunity(db(), id), waterOpportunityHistory(db(), id)]);
    res.json({ ...opportunity, history });
  }),
);

/** Review a suggestion: { decision: "start" | "approve" | "reject", note?, owner_id? }. Rejecting needs a reason. */
waterRouter.post(
  "/:id/review",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const { decision, note, owner_id } = req.body ?? {};
    const actor = actorId(req);
    const w = await db().tx(async (q) => {
      if (decision === "start") return startReview(q, id, actor, { ownerId: owner_id || null, note });
      if (decision === "approve") return reviewWaterOpportunity(q, id, "approve", actor, note);
      if (decision === "reject") {
        if (!String(note ?? "").trim()) throw new HttpError(400, "Give a reason for rejecting — it is kept for the audit trail");
        return reviewWaterOpportunity(q, id, "reject", actor, note);
      }
      throw new HttpError(400, "decision must be start, approve or reject");
    });
    res.json(w);
  }),
);

/** Assign an owner, adjust potential, or change status (close with an outcome, reopen, reconsider). */
waterRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body ?? {};
    const actor = actorId(req);
    const w = await db().tx(async (q) => {
      let out = await updateWaterOpportunity(q, id, b, actor);
      if (b.status) {
        if (!WATER_OPPORTUNITY_STATUSES.includes(b.status)) throw new HttpError(400, "Unknown status");
        if (b.status === "rejected" && !String(b.note ?? "").trim() && (out.status === "suggested" || out.status === "needs_review")) {
          throw new HttpError(400, "Give a reason for rejecting — it is kept for the audit trail");
        }
        out = await changeWaterStatus(q, id, b.status, actor, { outcome: b.outcome, note: b.note });
      }
      return out;
    });
    res.json(w);
  }),
);

/**
 * Convert an approved opportunity to CRM: { organization_id (project opportunities: a stakeholder),
 * opportunity_type?, owner_id?, title? } creates one; { crm_opportunity_id } links an existing one.
 */
waterRouter.post(
  "/:id/convert",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body ?? {};
    const r = await db().tx((q) =>
      convertWaterOpportunity(
        q,
        id,
        {
          organizationId: optInt(b.organization_id, "organization_id") ?? null,
          opportunityType: b.opportunity_type || null,
          ownerId: b.owner_id || null,
          title: b.title,
          crmOpportunityId: optInt(b.crm_opportunity_id, "crm_opportunity_id") ?? null,
        },
        actorId(req),
      ),
    );
    res.status(r.created ? 201 : 200).json(r);
  }),
);
