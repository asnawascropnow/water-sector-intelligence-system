import { Router } from "express";
import { db } from "../db";
import type { FieldSource, OrganizationInput } from "../../shared/types";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import { audit, createSource, logActivity } from "../lib/log";
import { findDuplicates } from "../lib/duplicates";
import { gradeConfidence, inBengaluru, normalizeName, normalizeRecord } from "../lib/normalize";
import { getOrganization, insertOrganization, mergeIntoOrganization, ORG_SELECT } from "../lib/organizations";
import { assessAndStore } from "../agents/opportunity";
import { enrichOrganization } from "../agents/enrichment";
import { RECOMMENDATION_SELECT } from "../agents/runner";
import { todayIST } from "../lib/time";
import { OPP_SELECT, PRIMARY_OPPORTUNITY_ORDER } from "../lib/crm";
import { activeOrganizationTypes, viewTypes } from "../lib/catalog";
import { organizationProjects } from "../lib/projects";
import { addFact, changeFact, listFacts, retireFact } from "../lib/facts";
import { listWaterOpportunities, organizationProjectWaterOpportunities } from "../lib/waterOpportunities";

export const organizationsRouter = Router();

async function userName(id: number | null) {
  if (!id) return "unknown user";
  const { rows } = await db().query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [id]);
  return rows[0]?.name ?? "unknown user";
}

organizationsRouter.get(
  "/",
  ah(async (req, res) => {
    const { q, type, area, crm, potential, view } = req.query as Record<string, string | undefined>;
    const params: unknown[] = [];
    const where = ["org.merged_into IS NULL"];
    if (view) {
      // Saved Discover view: restrict to its member types (combined with any other filter below).
      const members = await viewTypes(db(), view);
      if (!members) throw new HttpError(400, `Unknown view "${view}"`);
      params.push(members);
      where.push(`org.org_type = ANY($${params.length}::text[])`);
    }
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      where.push(`(lower(org.name) LIKE $${params.length} OR lower(coalesce(org.area,'')) LIKE $${params.length} OR lower(coalesce(org.address,'')) LIKE $${params.length} OR lower(coalesce(org.sector,'')) LIKE $${params.length})`);
    }
    if (type) {
      params.push(type.split(","));
      where.push(`org.org_type = ANY($${params.length}::text[])`);
    }
    if (area) {
      params.push(area);
      where.push(`org.area = $${params.length}`);
    }
    if (potential) {
      params.push(potential.split(","));
      where.push(`coalesce(org.intelligence->>'potential', 'Unknown') = ANY($${params.length}::text[])`);
    }
    // "In CRM" = any opportunity (relationship or project); "relationship" = has a relationship opportunity.
    if (crm === "in") where.push(`EXISTS (SELECT 1 FROM crm_opportunities c WHERE c.organization_id = org.id)`);
    if (crm === "out") where.push(`NOT EXISTS (SELECT 1 FROM crm_opportunities c WHERE c.organization_id = org.id)`);
    if (crm === "relationship") where.push(`o.id IS NOT NULL`);
    const { rows } = await db().query(`${ORG_SELECT} WHERE ${where.join(" AND ")} ORDER BY org.name LIMIT 5000`, params);
    res.json(rows);
  }),
);

organizationsRouter.get(
  "/areas",
  ah(async (_req, res) => {
    const { rows } = await db().query<{ area: string }>(`SELECT DISTINCT area FROM organizations WHERE area IS NOT NULL AND merged_into IS NULL ORDER BY area`);
    res.json(rows.map((r) => r.area));
  }),
);

organizationsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const q = db();
    const { rows: m } = await q.query<{ merged_into: number | null }>(`SELECT merged_into FROM organizations WHERE id = $1`, [id]);
    if (!m[0]) throw new HttpError(404, "Organization not found");
    if (m[0].merged_into) return res.json({ merged_into: m[0].merged_into });
    const organization = await getOrganization(q, id);
    const contacts = (
      await q.query(
        `SELECT c.id, c.organization_id, c.name, c.designation, c.phone, c.email, c.is_primary, s.label AS source_label
           FROM contacts c LEFT JOIN sources s ON s.id = c.source_id WHERE c.organization_id = $1 ORDER BY c.is_primary DESC, c.id`,
        [id],
      )
    ).rows;
    const activities = (
      await q.query(
        `SELECT a.id, a.organization_id, a.opportunity_id, a.type, a.summary, a.details, a.actor_id, u.name AS actor_name, a.occurred_at
           FROM activities a LEFT JOIN users u ON u.id = a.actor_id WHERE a.organization_id = $1 ORDER BY a.occurred_at DESC, a.id DESC`,
        [id],
      )
    ).rows;
    const tasks = (
      await q.query(
        `SELECT t.*, org.name AS organization_name, u.name AS assigned_name, (t.status = 'Pending' AND t.due_date < $2) AS overdue
           FROM tasks t LEFT JOIN organizations org ON org.id = t.organization_id LEFT JOIN users u ON u.id = t.assigned_to
          WHERE t.organization_id = $1 ORDER BY (t.status = 'Pending') DESC, t.due_date NULLS LAST`,
        [id, todayIST()],
      )
    ).rows;
    // The MVP CRM panel manages the organization's relationship opportunity; project-pipeline opportunities
    // are listed separately in `opportunities` (WSIS Phase 5).
    const opportunity = (await q.query(`${OPP_SELECT} WHERE o.organization_id = $1 AND o.pipeline = 'relationship' ORDER BY ${PRIMARY_OPPORTUNITY_ORDER} LIMIT 1`, [id])).rows[0] ?? null;
    const suggestions = (await q.query(`${RECOMMENDATION_SELECT} WHERE r.organization_id = $1 AND r.agent = 'enrichment' AND r.status = 'open' ORDER BY r.id`, [id])).rows;
    const recommendations = (await q.query(`${RECOMMENDATION_SELECT} WHERE r.organization_id = $1 AND r.agent <> 'enrichment' AND r.status = 'open' ORDER BY r.id`, [id])).rows;
    // WSIS Phase 4 (additive): every CRM opportunity and the organization's project links.
    const opportunities = (await q.query(`${OPP_SELECT} WHERE o.organization_id = $1 ORDER BY ${PRIMARY_OPPORTUNITY_ORDER}`, [id])).rows;
    const projects = await organizationProjects(q, id);
    const facts = await listFacts(q, "organization", id);
    // WSIS Phase 6: organization-level water opportunities, and — separately — those on its projects.
    const water_opportunities = {
      organization: await listWaterOpportunities(q, { organizationId: id, organizationLevelOnly: true }),
      projects: await organizationProjectWaterOpportunities(q, id),
    };
    res.json({ organization, contacts, activities, tasks, opportunity, opportunities, projects, facts, water_opportunities, suggestions, recommendations });
  }),
);

/** Projects this organization is linked to, with its role on each. */
organizationsRouter.get(
  "/:id/projects",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const { rows } = await db().query<{ merged_into: number | null }>(`SELECT merged_into FROM organizations WHERE id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, "Organization not found");
    res.json(await organizationProjects(db(), id));
  }),
);

organizationsRouter.post(
  "/check-duplicates",
  ah(async (req, res) => {
    const { data } = normalizeRecord(req.body as OrganizationInput, "manual");
    res.json(await findDuplicates(db(), data, req.body.exclude_id));
  }),
);

/** Manual creation. Returns 409 with duplicate candidates unless the user chose "keep separate" (force) or "merge". */
organizationsRouter.post(
  "/",
  ah(async (req, res) => {
    const actor = actorId(req);
    const { data: raw, force, merge_into } = req.body as { data: OrganizationInput; force?: boolean; merge_into?: number };
    const who = await userName(actor);
    const label = `Manual entry by ${who}`;
    const norm = normalizeRecord(raw, label, await activeOrganizationTypes(db()));
    if (!norm.data.name) throw new HttpError(400, "Organization name is required");
    const result = await db().tx(async (q) => {
      if (!force && !merge_into) {
        const dup = await findDuplicates(q, norm.data);
        if (dup.level !== "new") throw new HttpError(409, "Possible duplicate found", { duplicate: dup, warnings: norm.warnings });
      }
      const sourceId = await createSource(q, { kind: "manual", label, createdBy: actor });
      if (merge_into) {
        const r = await mergeIntoOrganization(q, merge_into, norm.data, { fieldSources: norm.field_sources, sourceId, actorId: actor, sourceLabel: label });
        return { id: merge_into, merged: true, ...r };
      }
      const id = await insertOrganization(q, norm.data, { fieldSources: norm.field_sources, sourceId, actorId: actor, activitySummary: `Organization added by ${who}` });
      return { id, merged: false };
    });
    res.status(201).json({ ...result, warnings: norm.warnings });
  }),
);

const EDITABLE = ["name", "org_type", "sector", "address", "area", "pincode", "website", "phone", "email"] as const;

organizationsRouter.patch(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const actor = actorId(req);
    const who = await userName(actor);
    const body = req.body as OrganizationInput & { lat?: number | null; lng?: number | null };
    const out = await db().tx(async (q) => {
      const current = await getOrganization(q, id);
      if (!current) throw new HttpError(404, "Organization not found");
      // An empty type means "not known": store the catalog's "Other" and label it Unknown below.
      const typeCleared = "org_type" in body && !String(body.org_type ?? "").trim();
      if (typeCleared) body.org_type = "Other";
      if (body.org_type) {
        const canonical = (await activeOrganizationTypes(q)).get(String(body.org_type).toLowerCase());
        if (!canonical) throw new HttpError(400, "Unknown organization type");
        body.org_type = canonical as typeof body.org_type;
      }
      const fs: Record<string, FieldSource> = { ...current.field_sources };
      const sets: string[] = [];
      const params: unknown[] = [id];
      const changed: Record<string, [unknown, unknown]> = {};
      for (const f of EDITABLE) {
        if (!(f in body)) continue;
        const v = typeof body[f] === "string" ? (body[f] as string).trim() || null : body[f] ?? null;
        if (f === "name" && !v) throw new HttpError(400, "Name cannot be empty");
        if (v === current[f]) continue;
        params.push(v);
        sets.push(`${f} = $${params.length}`);
        if (f === "name") {
          params.push(normalizeName(v as string));
          sets.push(`normalized_name = $${params.length}`);
        }
        changed[f] = [current[f], v];
        fs[f] = v == null || (f === "org_type" && typeCleared) ? { provenance: "Unknown", source: null } : { provenance: "Verified", source: `Edited by ${who}` };
      }
      if ("lat" in body || "lng" in body) {
        const lat = body.lat ?? null;
        const lng = body.lng ?? null;
        if ((lat == null) !== (lng == null)) throw new HttpError(400, "Provide both latitude and longitude");
        if (lat != null && !inBengaluru(lat, lng)) throw new HttpError(400, "Location must be within the Bengaluru area");
        if (lat !== current.lat || lng !== current.lng) {
          params.push(lng, lat);
          sets.push(`geom = CASE WHEN $${params.length}::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography END`);
          changed.location = [[current.lat, current.lng], [lat, lng]];
          fs.location = lat == null ? { provenance: "Unknown", source: null } : { provenance: "Verified", source: `Set by ${who}` };
        }
      }
      if (!sets.length) return current;
      params.push(JSON.stringify(fs));
      sets.push(`field_sources = $${params.length}`);
      await q.query(`UPDATE organizations SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
      const after = (await getOrganization(q, id))!;
      const conf = gradeConfidence(after, after.field_sources);
      await q.query(`UPDATE organizations SET data_confidence = $2 WHERE id = $1`, [id, conf]);
      await logActivity(q, { organizationId: id, type: "org_updated", summary: `Details updated by ${who}: ${Object.keys(changed).join(", ")}`, details: { changed }, actorId: actor });
      await audit(q, actor, "organization", id, "update", changed);
      await assessAndStore(q, id);
      return getOrganization(q, id);
    });
    res.json(out);
  }),
);

organizationsRouter.post(
  "/:id/contacts",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const actor = actorId(req);
    const { name, designation, phone, email, is_primary } = req.body ?? {};
    if (!name?.trim()) throw new HttpError(400, "Contact name is required");
    const who = await userName(actor);
    const contact = await db().tx(async (q) => {
      const sourceId = await createSource(q, { kind: "manual", label: `Manual entry by ${who}`, createdBy: actor });
      if (is_primary) await q.query(`UPDATE contacts SET is_primary = FALSE WHERE organization_id = $1`, [id]);
      const { rows } = await q.query(
        `INSERT INTO contacts (organization_id, name, designation, phone, email, is_primary, source_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, name.trim(), designation || null, phone || null, email || null, Boolean(is_primary), sourceId],
      );
      await logActivity(q, { organizationId: id, type: "contact_added", summary: `Contact added: ${name.trim()}${designation ? ` (${designation})` : ""}`, actorId: actor });
      await audit(q, actor, "contact", rows[0].id, "create", req.body);
      return rows[0];
    });
    res.status(201).json(contact);
  }),
);

organizationsRouter.post(
  "/:id/water-info",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const actor = actorId(req);
    const { text, provenance, source } = req.body ?? {};
    if (!text?.trim()) throw new HttpError(400, "Text is required");
    const entry = { text: text.trim(), provenance: ["Verified", "Unverified", "Estimated", "AI Inference"].includes(provenance) ? provenance : "Unverified", source: source?.trim() || null };
    await db().tx(async (q) => {
      await q.query(
        `UPDATE organizations SET intelligence = jsonb_set(intelligence, '{waterInfo}', coalesce(intelligence->'waterInfo', '[]'::jsonb) || $2::jsonb), updated_at = now() WHERE id = $1`,
        [id, JSON.stringify([entry])],
      );
      await logActivity(q, { organizationId: id, type: "water_info", summary: `Water information added (${entry.provenance}): ${entry.text}`, actorId: actor });
      await assessAndStore(q, id);
    });
    res.status(201).json(entry);
  }),
);

organizationsRouter.post(
  "/:id/assess",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const result = await db().tx(async (q) => {
      const r = await assessAndStore(q, id);
      if (!r) throw new HttpError(404, "Organization not found");
      await logActivity(q, { organizationId: id, type: "ai_assessed", summary: `Opportunity agent: potential ${r.potential} (confidence ${r.confidence})`, details: r, actorId: actorId(req) });
      return r;
    });
    res.json(result);
  }),
);

organizationsRouter.post(
  "/:id/enrich",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const result = await enrichOrganization(db(), id);
    await logActivity(db(), {
      organizationId: id,
      type: "enrichment",
      summary: `Enrichment agent checked ${result.sourcesTried.join(", ") || "no sources (add a website or address)"} — ${result.added} new suggestion(s)`,
      actorId: actorId(req),
    });
    res.json(result);
  }),
);

/** Accept or dismiss an enrichment suggestion. Accepting writes the value with its source and provenance label. */
organizationsRouter.post(
  "/:id/suggestions/:recId/:decision",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const recId = intParam(req.params.recId, "suggestion id");
    const decision = req.params.decision;
    if (decision !== "accept" && decision !== "dismiss") throw new HttpError(400, "Decision must be accept or dismiss");
    const actor = actorId(req);
    await db().tx(async (q) => {
      const { rows } = await q.query<{ payload: any; status: string }>(`SELECT payload, status FROM agent_recommendations WHERE id = $1 AND organization_id = $2 AND agent = 'enrichment'`, [recId, id]);
      const rec = rows[0];
      if (!rec || rec.status !== "open") throw new HttpError(404, "Suggestion not found");
      await q.query(`UPDATE agent_recommendations SET status = $2, resolved_at = now() WHERE id = $1`, [recId, decision === "accept" ? "done" : "dismissed"]);
      if (decision === "dismiss") return;
      const s = rec.payload as { field: string; value: any; source: string; provenance: string };
      const fsEntry = { provenance: s.provenance, source: s.source };
      if (s.field === "water_info") {
        await q.query(
          `UPDATE organizations SET intelligence = jsonb_set(intelligence, '{waterInfo}', coalesce(intelligence->'waterInfo', '[]'::jsonb) || $2::jsonb), updated_at = now() WHERE id = $1`,
          [id, JSON.stringify([{ text: s.value, provenance: s.provenance, source: s.source }])],
        );
      } else if (s.field === "location") {
        await q.query(
          `UPDATE organizations SET geom = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, field_sources = field_sources || $4::jsonb, updated_at = now() WHERE id = $1`,
          [id, s.value.lng, s.value.lat, JSON.stringify({ location: fsEntry })],
        );
      } else if (["website", "phone", "email", "sector", "org_type", "address"].includes(s.field)) {
        await q.query(`UPDATE organizations SET ${s.field} = $2, field_sources = field_sources || $3::jsonb, updated_at = now() WHERE id = $1`, [
          id,
          s.value,
          JSON.stringify({ [s.field]: fsEntry }),
        ]);
      }
      const src = await createSource(q, { kind: s.provenance === "AI Inference" ? "ai_inference" : s.field === "location" ? "geocoder" : "website", label: s.source, url: /^https?:/.test(s.source) ? s.source : null, createdBy: actor });
      void src;
      await logActivity(q, { organizationId: id, type: "enriched", summary: `Accepted ${s.field.replace("_", " ")} from ${s.source} (${s.provenance})`, details: s, actorId: actor });
      await audit(q, actor, "organization", id, "accept_enrichment", s);
      await assessAndStore(q, id);
    });
    res.json({ ok: true });
  }),
);

/** Merge one organization record into another (Rule 4). History moves to the surviving record. */
organizationsRouter.post(
  "/:id/merge-into/:targetId",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const targetId = intParam(req.params.targetId, "target id");
    if (id === targetId) throw new HttpError(400, "Cannot merge a record into itself");
    const actor = actorId(req);
    await db().tx(async (q) => {
      const src = await getOrganization(q, id);
      const target = await getOrganization(q, targetId);
      if (!src || !target) throw new HttpError(404, "Organization not found");
      if (src.opportunity_id && target.opportunity_id) throw new HttpError(409, "Both records have CRM opportunities — close one before merging");
      await mergeIntoOrganization(q, targetId, { ...src, lat: src.lat, lng: src.lng }, { fieldSources: src.field_sources, sourceId: src.source_id, actorId: actor, sourceLabel: `duplicate record “${src.name}”` });
      for (const t of ["contacts", "activities", "tasks", "crm_opportunities", "agent_recommendations"]) {
        await q.query(`UPDATE ${t} SET organization_id = $2 WHERE organization_id = $1`, [id, targetId]);
      }
      // WSIS tables: move rows unless the surviving record already has the same fact / role / live
      // opportunity. Rows that would collide stay on the merged record (still reachable through
      // merged_into) — nothing is deleted.
      await q.query(
        `UPDATE organization_facts f SET organization_id = $2 WHERE f.organization_id = $1 AND (f.retired_at IS NOT NULL OR NOT EXISTS (
           SELECT 1 FROM organization_facts t WHERE t.organization_id = $2 AND t.fact_key = f.fact_key AND lower(t.value) = lower(f.value) AND t.retired_at IS NULL))`,
        [id, targetId],
      );
      await q.query(
        `UPDATE project_organizations p SET organization_id = $2, updated_at = now() WHERE p.organization_id = $1 AND NOT EXISTS (
           SELECT 1 FROM project_organizations t WHERE t.organization_id = $2 AND t.project_id = p.project_id AND t.role = p.role)`,
        [id, targetId],
      );
      await q.query(
        `UPDATE water_opportunities w SET organization_id = $2, updated_at = now() WHERE w.organization_id = $1 AND (w.status IN ('rejected','closed') OR NOT EXISTS (
           SELECT 1 FROM water_opportunities t WHERE t.organization_id = $2 AND coalesce(t.project_id, 0) = coalesce(w.project_id, 0)
              AND t.intervention_type = w.intervention_type AND t.context_key = w.context_key AND t.status NOT IN ('rejected','closed')))`,
        [id, targetId],
      );
      await q.query(`UPDATE organizations SET merged_into = $2, updated_at = now() WHERE id = $1`, [id, targetId]);
      await audit(q, actor, "organization", id, "merged_into", { target: targetId });
    });
    res.json({ id: targetId });
  }),
);

/* ---------------- Organization facts (Built Environment Intelligence) ---------------- */

organizationsRouter.get(
  "/:id/facts",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    if (!(await db().query(`SELECT 1 FROM organizations WHERE id = $1`, [id])).rows.length) throw new HttpError(404, "Organization not found");
    res.json(await listFacts(db(), "organization", id, { includeRetired: req.query.include_retired === "1" || req.query.include_retired === "true" }));
  }),
);

organizationsRouter.post(
  "/:id/facts",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const b = req.body ?? {};
    if (!b.key) throw new HttpError(400, "key is required");
    const r = await db().tx((q) =>
      addFact(q, "organization", id, { key: String(b.key), value: b.value, provenance: b.provenance, confidence: b.confidence, source: b.source, note: b.note }, actorId(req)),
    );
    res.status(201).json(r);
  }),
);

/** Change a fact: the current version is retired and a new version is recorded (history kept). */
organizationsRouter.patch(
  "/:id/facts/:factId",
  ah(async (req, res) => {
    const b = req.body ?? {};
    const r = await db().tx((q) =>
      changeFact(q, "organization", intParam(req.params.id), intParam(req.params.factId, "fact id"), { value: b.value, provenance: b.provenance, confidence: b.confidence, source: b.source, note: b.note }, actorId(req)),
    );
    res.json(r);
  }),
);

organizationsRouter.delete(
  "/:id/facts/:factId",
  ah(async (req, res) => {
    const orgId = intParam(req.params.id);
    const factId = intParam(req.params.factId, "fact id");
    await db().tx(async (q) => {
      if (!(await q.query(`SELECT 1 FROM organization_facts WHERE id = $1 AND organization_id = $2`, [factId, orgId])).rows.length) throw new HttpError(404, "Fact not found");
      await retireFact(q, "organization", factId, actorId(req));
    });
    res.status(204).end();
  }),
);
