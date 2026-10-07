import type { Queryable } from "../db";
import type { FieldSource, Organization, OrganizationInput } from "../../shared/types";
import { assessAndStore } from "../agents/opportunity";
import { audit, logActivity } from "./log";
import { gradeConfidence, normalizeName } from "./normalize";
import { PRIMARY_OPPORTUNITY_ORDER } from "./crm";

export const ORG_SELECT = `
  SELECT org.id, org.name, org.org_type, org.sector, org.address, org.area, org.city, org.pincode,
         ST_Y(org.geom::geometry) AS lat, ST_X(org.geom::geometry) AS lng,
         org.website, org.phone, org.email, org.source_id, s.label AS source_label, org.data_confidence,
         org.field_sources, org.intelligence, org.created_at, org.updated_at,
         o.id AS opportunity_id, o.status AS crm_status, u.name AS owner_name,
         (SELECT count(*)::int FROM crm_opportunities c WHERE c.organization_id = org.id) AS crm_opportunity_count,
         (SELECT count(*)::int FROM crm_opportunities c WHERE c.organization_id = org.id AND c.pipeline = 'project') AS project_opportunity_count
    FROM organizations org
    LEFT JOIN sources s ON s.id = org.source_id
    -- The organization's own relationship (never a project opportunity): see PRIMARY_OPPORTUNITY_ORDER.
    LEFT JOIN LATERAL (
      SELECT o.id, o.status, o.owner_id FROM crm_opportunities o
       WHERE o.organization_id = org.id AND o.pipeline = 'relationship'
       ORDER BY ${PRIMARY_OPPORTUNITY_ORDER}
       LIMIT 1
    ) o ON TRUE
    LEFT JOIN users u ON u.id = o.owner_id`;

export async function getOrganization(q: Queryable, id: number): Promise<Organization | null> {
  const { rows } = await q.query<Organization>(`${ORG_SELECT} WHERE org.id = $1`, [id]);
  return rows[0] ?? null;
}

/** Insert a new organization (caller has already done duplicate checking / human review). */
export async function insertOrganization(
  q: Queryable,
  d: OrganizationInput,
  opts: { fieldSources: Record<string, FieldSource>; sourceId: number | null; actorId: number | null; activitySummary: string; importId?: number },
): Promise<number> {
  const confidence = gradeConfidence(d, opts.fieldSources);
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO organizations (name, normalized_name, org_type, sector, address, area, city, pincode, geom, website, phone, email,
                                source_id, data_confidence, field_sources, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, coalesce($7, 'Bengaluru'), $8,
             CASE WHEN $9::float8 IS NULL OR $10::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography END,
             $11, $12, $13, $14, $15, $16, $17)
     RETURNING id`,
    [
      d.name.trim(), normalizeName(d.name), d.org_type ?? "Other", d.sector ?? null, d.address ?? null, d.area ?? null, d.city ?? null,
      d.pincode ?? null, d.lat ?? null, d.lng ?? null, d.website ?? null, d.phone ?? null, d.email ?? null,
      opts.sourceId, confidence, JSON.stringify(opts.fieldSources), opts.actorId,
    ],
  );
  const id = rows[0].id;
  if (d.contact_name) {
    await q.query(
      `INSERT INTO contacts (organization_id, name, designation, phone, email, is_primary, source_id) VALUES ($1, $2, $3, NULL, NULL, TRUE, $4)`,
      [id, d.contact_name, d.contact_designation ?? null, opts.sourceId],
    );
  }
  await logActivity(q, { organizationId: id, type: "org_created", summary: opts.activitySummary, actorId: opts.actorId, details: opts.importId ? { import_id: opts.importId } : {} });
  await audit(q, opts.actorId, "organization", id, "create", { data: d });
  await assessAndStore(q, id);
  return id;
}

const MERGEABLE = ["org_type", "sector", "address", "area", "pincode", "website", "phone", "email"] as const;

/**
 * Merge incoming data into an existing organization (Rule 4 — one record per organization).
 * Only empty fields are filled; conflicting values are kept on the existing record and noted in the timeline.
 */
export async function mergeIntoOrganization(
  q: Queryable,
  targetId: number,
  d: OrganizationInput,
  opts: { fieldSources: Record<string, FieldSource>; sourceId: number | null; actorId: number | null; sourceLabel: string },
): Promise<{ filled: string[]; conflicts: string[] }> {
  const existing = await getOrganization(q, targetId);
  if (!existing) throw new Error("Merge target not found");
  const filled: string[] = [];
  const conflicts: string[] = [];
  const updates: Record<string, unknown> = {};
  const fs = { ...existing.field_sources };
  for (const f of MERGEABLE) {
    const incoming = d[f];
    if (incoming == null || incoming === "") continue;
    const current = existing[f];
    const currentEmpty = current == null || current === "" || (f === "org_type" && current === "Other");
    if (currentEmpty) {
      updates[f] = incoming;
      filled.push(f);
      if (opts.fieldSources[f]) fs[f] = opts.fieldSources[f];
    } else if (String(current).toLowerCase() !== String(incoming).toLowerCase()) conflicts.push(`${f}: kept "${current}", ignored "${incoming}"`);
  }
  let setGeom = false;
  if (existing.lat == null && d.lat != null && d.lng != null) {
    setGeom = true;
    filled.push("location");
    if (opts.fieldSources.location) fs.location = opts.fieldSources.location;
  }
  const cols = Object.keys(updates);
  const params: unknown[] = [targetId, JSON.stringify(fs)];
  const sets = cols.map((c) => {
    params.push(updates[c]);
    return `${c} = $${params.length}`;
  });
  if (setGeom) {
    params.push(d.lng, d.lat);
    sets.push(`geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography`);
  }
  await q.query(`UPDATE organizations SET field_sources = $2, updated_at = now()${sets.length ? ", " + sets.join(", ") : ""} WHERE id = $1`, params);

  if (d.contact_name) {
    const { rows } = await q.query(`SELECT 1 FROM contacts WHERE organization_id = $1 AND lower(name) = lower($2)`, [targetId, d.contact_name]);
    if (!rows.length) {
      await q.query(`INSERT INTO contacts (organization_id, name, designation, source_id) VALUES ($1, $2, $3, $4)`, [targetId, d.contact_name, d.contact_designation ?? null, opts.sourceId]);
      filled.push("contact");
    }
  }
  await logActivity(q, {
    organizationId: targetId,
    type: "merged",
    summary: `Merged data from ${opts.sourceLabel}${filled.length ? ` — added ${filled.join(", ")}` : " — no new fields"}`,
    details: { filled, conflicts, incoming_name: d.name },
    actorId: opts.actorId,
  });
  await audit(q, opts.actorId, "organization", targetId, "merge", { filled, conflicts, incoming: d });
  await assessAndStore(q, targetId);
  return { filled, conflicts };
}
