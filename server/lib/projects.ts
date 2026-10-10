import type { Queryable } from "../db";
import { CITY, FACT_PROVENANCE, LIFECYCLE_STAGES, PROJECT_SCALES, type FactProvenance } from "../../shared/constants";
import type { FieldSource, Project, ProjectInput, ProjectListItem, ProjectStakeholder } from "../../shared/types";
import { HttpError } from "./http";
import { audit, logActivity, logProjectActivity } from "./log";
import { inCatalog } from "./catalog";
import { cleanText, extractArea, extractPincode, inBengaluru, normalizeName, normalizeWebsite, toNumber } from "./normalize";

export const PROJECT_SELECT = `
  SELECT p.id, p.name, p.project_type, p.description, p.address, p.area, p.city, p.pincode,
         ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lng, p.website, p.lifecycle_stage, p.scale,
         p.built_up_area_sqft, p.building_count, p.unit_count, s.label AS source_label, p.data_confidence,
         p.field_sources, p.notes, p.merged_into, p.intelligence, cu.name AS created_by_name, uu.name AS updated_by_name,
         p.created_at, p.updated_at
    FROM projects p
    LEFT JOIN sources s ON s.id = p.source_id
    LEFT JOIN users cu ON cu.id = p.created_by
    LEFT JOIN users uu ON uu.id = p.updated_by`;

export async function getProject(q: Queryable, id: number): Promise<Project | null> {
  return (await q.query<Project>(`${PROJECT_SELECT} WHERE p.id = $1`, [id])).rows[0] ?? null;
}

function positive(v: unknown, label: string, integer: boolean): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = toNumber(v);
  if (n === null || n <= 0 || (integer && !Number.isInteger(n))) throw new HttpError(400, `${label} must be a positive ${integer ? "whole number" : "number"}`);
  return n;
}

/**
 * Validate and normalise project input. Values read from the input are labelled with `sourceLabel`;
 * values derived from other fields (area/pincode parsed from the address) are labelled as such.
 * Nothing is guessed: missing type / stage / scale stay Unknown.
 */
export async function normalizeProject(q: Queryable, input: ProjectInput, sourceLabel: string, provenance: FactProvenance = "Unverified") {
  const name = cleanText(input.name);
  if (!name) throw new HttpError(400, "Project name is required");
  const fs: Record<string, FieldSource> = { name: { provenance, source: sourceLabel } };
  const label = (k: string, v: unknown) => {
    if (v !== null && v !== undefined) fs[k] = { provenance, source: sourceLabel };
  };

  const project_type = cleanText(input.project_type);
  if (project_type && !(await inCatalog(q, "project_types", project_type))) throw new HttpError(400, `Unknown project type "${project_type}"`);
  const lifecycle_stage = input.lifecycle_stage ?? "Unknown";
  if (!LIFECYCLE_STAGES.includes(lifecycle_stage)) throw new HttpError(400, `Unknown lifecycle stage "${lifecycle_stage}"`);
  const scale = input.scale ?? "Unknown";
  if (!PROJECT_SCALES.includes(scale)) throw new HttpError(400, `Unknown project scale "${scale}"`);

  const address = cleanText(input.address);
  let pincode = cleanText(input.pincode)?.replace(/\s/g, "") ?? null;
  if (pincode && !/^\d{6}$/.test(pincode)) throw new HttpError(400, "Pincode must be 6 digits");
  if (pincode) label("pincode", pincode);
  else if ((pincode = extractPincode(address))) fs.pincode = { provenance: "Unverified", source: "Parsed from address" };
  let area = cleanText(input.area);
  if (area) label("area", area);
  else if ((area = extractArea(address))) fs.area = { provenance: "Unverified", source: "Parsed from address" };

  const lat = toNumber(input.lat);
  const lng = toNumber(input.lng);
  if ((lat === null) !== (lng === null)) throw new HttpError(400, "Provide both latitude and longitude, or neither");
  if (lat !== null && !inBengaluru(lat, lng)) throw new HttpError(400, "Location must be within the Bengaluru area");
  if (lat !== null) label("location", lat);

  const website = input.website ? normalizeWebsite(input.website) : null;
  if (input.website && !website) throw new HttpError(400, "Website is not a valid URL");
  const data = {
    name,
    project_type,
    description: cleanText(input.description),
    address,
    area,
    pincode,
    lat,
    lng,
    website,
    lifecycle_stage,
    scale,
    built_up_area_sqft: positive(input.built_up_area_sqft, "Built-up area", false),
    building_count: positive(input.building_count, "Number of buildings", true),
    unit_count: positive(input.unit_count, "Number of units", true),
    notes: cleanText(input.notes),
  };
  for (const k of ["project_type", "description", "address", "website", "built_up_area_sqft", "building_count", "unit_count"] as const) label(k, data[k]);
  if (lifecycle_stage !== "Unknown") label("lifecycle_stage", lifecycle_stage);
  if (scale !== "Unknown") label("scale", scale);
  return { data, fieldSources: fs };
}

export async function createProject(
  q: Queryable,
  input: ProjectInput,
  opts: { sourceId: number | null; sourceLabel: string; provenance?: FactProvenance; actorId: number | null },
): Promise<Project> {
  const { data: d, fieldSources } = await normalizeProject(q, input, opts.sourceLabel, opts.provenance);
  const known = Object.keys(fieldSources).length;
  const confidence = known >= 7 ? "Medium" : "Low"; // projects start at most Medium until verified
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO projects (name, normalized_name, project_type, description, address, area, city, pincode, geom, website,
                           lifecycle_stage, scale, built_up_area_sqft, building_count, unit_count, source_id, data_confidence,
                           field_sources, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
             CASE WHEN $9::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($10, $9), 4326)::geography END,
             $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
     RETURNING id`,
    [
      d.name, normalizeName(d.name), d.project_type, d.description, d.address, d.area, CITY.name, d.pincode, d.lat, d.lng,
      d.website, d.lifecycle_stage, d.scale, d.built_up_area_sqft, d.building_count, d.unit_count, opts.sourceId, confidence,
      JSON.stringify(fieldSources), d.notes, opts.actorId,
    ],
  );
  await audit(q, opts.actorId, "project", rows[0].id, "create", { data: d });
  await logProjectActivity(q, { projectId: rows[0].id, type: "project_created", summary: `Project added (${opts.sourceLabel})`, actorId: opts.actorId });
  return (await getProject(q, rows[0].id))!;
}

export const STAKEHOLDER_SELECT = `
  SELECT po.id, po.project_id, p.name AS project_name, po.organization_id, o.name AS organization_name, o.org_type,
         po.role, po.is_primary, po.source, po.provenance, po.confidence, po.notes,
         p.project_type, p.lifecycle_stage, cu.name AS created_by_name, uu.name AS updated_by_name, po.created_at, po.updated_at
    FROM project_organizations po
    JOIN projects p ON p.id = po.project_id
    JOIN organizations o ON o.id = po.organization_id
    LEFT JOIN users cu ON cu.id = po.created_by
    LEFT JOIN users uu ON uu.id = po.updated_by`;

export interface StakeholderInput {
  projectId: number;
  organizationId: number;
  role: string;
  isPrimary?: boolean;
  provenance: FactProvenance;
  confidence?: "High" | "Medium" | "Low" | "Unknown";
  source?: string | null;
  sourceId?: number | null;
  notes?: string | null;
}

/** Link an organization to a project in a role. Logged on the organization's timeline. */
export async function addStakeholder(q: Queryable, input: StakeholderInput, actorId: number | null): Promise<ProjectStakeholder> {
  const project = await getProject(q, input.projectId);
  if (!project) throw new HttpError(404, "Project not found");
  if (project.merged_into) throw new HttpError(409, `This project was merged into #${project.merged_into}`);
  const org = (await q.query<{ name: string; merged_into: number | null }>(`SELECT name, merged_into FROM organizations WHERE id = $1`, [input.organizationId])).rows[0];
  if (!org) throw new HttpError(404, "Organization not found");
  if (org.merged_into) throw new HttpError(409, `This organization was merged into #${org.merged_into}`);
  if (!(await inCatalog(q, "stakeholder_roles", input.role))) throw new HttpError(400, `Unknown stakeholder role "${input.role}"`);
  if (!FACT_PROVENANCE.includes(input.provenance)) throw new HttpError(400, "Invalid provenance");
  const source = input.source?.trim() || null;
  if (input.provenance !== "Verified" && !source && !input.sourceId) throw new HttpError(400, "Unverified links must cite a source");

  const existing = (await q.query(`SELECT 1 FROM project_organizations WHERE project_id = $1 AND organization_id = $2 AND role = $3`, [input.projectId, input.organizationId, input.role])).rows;
  if (existing.length) throw new HttpError(409, `${org.name} is already linked to ${project.name} as ${input.role}`);
  if (input.isPrimary) {
    const primary = (await q.query<{ name: string }>(
      `SELECT o.name FROM project_organizations po JOIN organizations o ON o.id = po.organization_id WHERE po.project_id = $1 AND po.role = $2 AND po.is_primary`,
      [input.projectId, input.role],
    )).rows[0];
    if (primary) throw new HttpError(409, `${primary.name} is already the primary ${input.role} on ${project.name}`);
  }
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO project_organizations (project_id, organization_id, role, is_primary, source, source_id, provenance, confidence, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [input.projectId, input.organizationId, input.role, Boolean(input.isPrimary), source, input.sourceId ?? null, input.provenance, input.confidence ?? "Unknown", input.notes?.trim() || null, actorId],
  );
  await logActivity(q, {
    organizationId: input.organizationId,
    type: "project_linked",
    summary: `Linked to project ${project.name} as ${input.role} (${input.provenance}${source ? `, source: ${source}` : ""})`,
    details: { project_id: input.projectId, role: input.role, link_id: rows[0].id },
    actorId,
  });
  await audit(q, actorId, "project_organization", rows[0].id, "create", input);
  await logProjectActivity(q, {
    projectId: input.projectId,
    type: "stakeholder_added",
    summary: `${org.name} added as ${input.role}${input.isPrimary ? " (primary)" : ""} — ${input.provenance}${source ? `, source: ${source}` : ""}`,
    details: { organization_id: input.organizationId, role: input.role, link_id: rows[0].id },
    actorId,
  });
  return (await q.query<ProjectStakeholder>(`${STAKEHOLDER_SELECT} WHERE po.id = $1`, [rows[0].id])).rows[0];
}

export async function projectStakeholders(q: Queryable, projectId: number): Promise<ProjectStakeholder[]> {
  return (await q.query<ProjectStakeholder>(`${STAKEHOLDER_SELECT} WHERE po.project_id = $1 ORDER BY po.role, po.is_primary DESC, o.name`, [projectId])).rows;
}

export async function organizationProjects(q: Queryable, organizationId: number): Promise<ProjectStakeholder[]> {
  return (await q.query<ProjectStakeholder>(
    `SELECT s.*, p2.area AS project_area,
            (SELECT count(*)::int FROM water_opportunities w WHERE w.project_id = s.project_id AND w.status NOT IN ('rejected','closed')) AS water_opportunity_count
       FROM (${STAKEHOLDER_SELECT} WHERE po.organization_id = $1 AND p.merged_into IS NULL) s
       JOIN projects p2 ON p2.id = s.project_id
      ORDER BY s.project_name, s.role`,
    [organizationId],
  )).rows;
}

/* ------------------------------------------------------------------------------------------------
 * Phase 4: list, update, stakeholder update/remove, merge
 * ---------------------------------------------------------------------------------------------- */

export interface ProjectFilters {
  q?: string;
  stages?: string[];
  types?: string[];
  scales?: string[];
  area?: string;
  pincode?: string;
  organizationId?: number;
  role?: string;
  near?: { lat: number; lng: number; radiusM: number };
  limit?: number;
}

/** Non-merged projects with a compact stakeholder summary. */
export async function listProjects(q: Queryable, f: ProjectFilters = {}): Promise<ProjectListItem[]> {
  const params: unknown[] = [];
  const where = ["p.merged_into IS NULL"];
  const add = (sql: (n: number) => string, v: unknown) => {
    params.push(v);
    where.push(sql(params.length));
  };
  if (f.q?.trim()) add((n) => `(lower(p.name) LIKE $${n} OR lower(coalesce(p.area,'')) LIKE $${n} OR lower(coalesce(p.address,'')) LIKE $${n} OR lower(coalesce(p.description,'')) LIKE $${n})`, `%${f.q.trim().toLowerCase()}%`);
  if (f.stages?.length) add((n) => `p.lifecycle_stage = ANY($${n}::text[])`, f.stages);
  if (f.types?.length) add((n) => `p.project_type = ANY($${n}::text[])`, f.types);
  if (f.scales?.length) add((n) => `p.scale = ANY($${n}::text[])`, f.scales);
  if (f.area) add((n) => `lower(p.area) = lower($${n})`, f.area);
  if (f.pincode) add((n) => `p.pincode = $${n}`, f.pincode);
  if (f.organizationId) {
    params.push(f.organizationId);
    const orgN = params.length;
    if (f.role) {
      params.push(f.role);
      where.push(`EXISTS (SELECT 1 FROM project_organizations x WHERE x.project_id = p.id AND x.organization_id = $${orgN} AND x.role = $${params.length})`);
    } else where.push(`EXISTS (SELECT 1 FROM project_organizations x WHERE x.project_id = p.id AND x.organization_id = $${orgN})`);
  } else if (f.role) add((n) => `EXISTS (SELECT 1 FROM project_organizations x WHERE x.project_id = p.id AND x.role = $${n})`, f.role);
  if (f.near) {
    params.push(f.near.lng, f.near.lat, f.near.radiusM);
    const n = params.length;
    where.push(`p.geom IS NOT NULL AND ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint($${n - 2}, $${n - 1}), 4326)::geography, $${n})`);
  }
  params.push(Math.min(Math.max(f.limit ?? 1000, 1), 5000));
  const { rows } = await q.query<ProjectListItem>(
    `SELECT b.*,
            (SELECT count(*)::int FROM project_organizations x WHERE x.project_id = b.id) AS stakeholder_count,
            (SELECT count(*)::int FROM water_opportunities w WHERE w.project_id = b.id AND w.status NOT IN ('rejected','closed')) AS water_opportunity_count,
            (SELECT count(*)::int FROM crm_opportunities c WHERE c.project_id = b.id) AS crm_opportunity_count,
            coalesce((SELECT json_agg(json_build_object('organization_id', o.id, 'organization_name', o.name, 'role', x.role, 'is_primary', x.is_primary)
                                      ORDER BY r.sort_order, x.is_primary DESC, o.name)
                        FROM project_organizations x JOIN organizations o ON o.id = x.organization_id JOIN stakeholder_roles r ON r.name = x.role
                       WHERE x.project_id = b.id), '[]'::json) AS stakeholders
       FROM (${PROJECT_SELECT} WHERE ${where.join(" AND ")}) b
      ORDER BY b.name, b.id
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

const UPDATABLE = ["name", "project_type", "description", "address", "area", "pincode", "website", "lifecycle_stage", "scale", "built_up_area_sqft", "building_count", "unit_count", "notes"] as const;

/**
 * Update a project. Only keys present in `body` change. Every changed value is labelled Verified
 * ("Edited by <user>"); a cleared value becomes Unknown. Validation is the same as on create.
 */
export async function updateProject(q: Queryable, id: number, body: ProjectInput & Record<string, unknown>, actorId: number | null, who: string): Promise<Project> {
  const cur = await getProject(q, id);
  if (!cur) throw new HttpError(404, "Project not found");
  if (cur.merged_into) throw new HttpError(409, `This project was merged into #${cur.merged_into}`);
  const merged: ProjectInput = { ...cur, lat: cur.lat, lng: cur.lng } as ProjectInput;
  for (const k of [...UPDATABLE, "lat", "lng"] as const) if (k in body) (merged as unknown as Record<string, unknown>)[k] = body[k];
  // A cleared stage/scale means Unknown.
  if ("lifecycle_stage" in body && !body.lifecycle_stage) merged.lifecycle_stage = "Unknown";
  if ("scale" in body && !body.scale) merged.scale = "Unknown";
  const { data } = await normalizeProject(q, merged, "edit");

  const fs: Record<string, FieldSource> = { ...cur.field_sources };
  const sets: string[] = [];
  const params: unknown[] = [id];
  const changed: Record<string, [unknown, unknown]> = {};
  const label = (key: string, value: unknown, unknown = false) => {
    fs[key] = value == null || unknown ? { provenance: "Unknown", source: null } : { provenance: "Verified", source: `Edited by ${who}` };
  };
  for (const k of UPDATABLE) {
    if (!(k in body)) continue;
    const v = (data as unknown as Record<string, unknown>)[k] ?? null;
    const before = (cur as unknown as Record<string, unknown>)[k] ?? null;
    if (v === before || (typeof v === "number" && Number(before) === v)) continue;
    params.push(v);
    sets.push(`${k} = $${params.length}`);
    if (k === "name") {
      params.push(normalizeName(v as string));
      sets.push(`normalized_name = $${params.length}`);
    }
    changed[k] = [before, v];
    label(k, v, (k === "lifecycle_stage" || k === "scale") && v === "Unknown");
  }
  if ("lat" in body || "lng" in body) {
    if (data.lat !== cur.lat || data.lng !== cur.lng) {
      params.push(data.lng, data.lat);
      sets.push(`geom = CASE WHEN $${params.length}::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography END`);
      changed.location = [[cur.lat, cur.lng], [data.lat, data.lng]];
      label("location", data.lat);
    }
  }
  if (!sets.length) return cur;
  params.push(JSON.stringify(fs), actorId);
  sets.push(`field_sources = $${params.length - 1}`, `updated_by = $${params.length}`);
  await q.query(`UPDATE projects SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
  await audit(q, actorId, "project", id, "update", changed);
  await logProjectActivity(q, { projectId: id, type: "project_updated", summary: `Details updated by ${who}: ${Object.keys(changed).join(", ")}`, details: { changed }, actorId });
  return (await getProject(q, id))!;
}

export interface StakeholderPatch {
  role?: string;
  isPrimary?: boolean;
  notes?: string | null;
  source?: string | null;
  provenance?: FactProvenance;
  confidence?: "High" | "Medium" | "Low" | "Unknown";
}

async function getLink(q: Queryable, projectId: number, linkId: number): Promise<ProjectStakeholder> {
  const link = (await q.query<ProjectStakeholder>(`${STAKEHOLDER_SELECT} WHERE po.id = $1 AND po.project_id = $2`, [linkId, projectId])).rows[0];
  if (!link) throw new HttpError(404, "Stakeholder link not found");
  return link;
}

/** Change a stakeholder link's role, primary flag, notes, source, provenance or confidence. */
export async function updateStakeholder(q: Queryable, projectId: number, linkId: number, patch: StakeholderPatch, actorId: number | null): Promise<ProjectStakeholder> {
  const cur = await getLink(q, projectId, linkId);
  const next = {
    role: patch.role ?? cur.role,
    is_primary: patch.isPrimary ?? cur.is_primary,
    notes: patch.notes !== undefined ? patch.notes?.trim() || null : cur.notes,
    source: patch.source !== undefined ? patch.source?.trim() || null : cur.source,
    provenance: patch.provenance ?? cur.provenance,
    confidence: patch.confidence ?? cur.confidence,
  };
  if (patch.role !== undefined && !(await inCatalog(q, "stakeholder_roles", next.role))) throw new HttpError(400, `Unknown stakeholder role "${next.role}"`);
  if (!FACT_PROVENANCE.includes(next.provenance)) throw new HttpError(400, "Invalid provenance");
  if (!["High", "Medium", "Low", "Unknown"].includes(next.confidence)) throw new HttpError(400, "Invalid confidence");
  if (next.provenance !== "Verified" && !next.source) throw new HttpError(400, "Unverified links must cite a source");
  if (next.role !== cur.role) {
    const dup = await q.query(`SELECT 1 FROM project_organizations WHERE project_id = $1 AND organization_id = $2 AND role = $3 AND id <> $4`, [projectId, cur.organization_id, next.role, linkId]);
    if (dup.rows.length) throw new HttpError(409, `${cur.organization_name} is already linked to ${cur.project_name} as ${next.role}`);
  }
  if (next.is_primary && (!cur.is_primary || next.role !== cur.role)) {
    const p = (await q.query<{ name: string }>(
      `SELECT o.name FROM project_organizations po JOIN organizations o ON o.id = po.organization_id WHERE po.project_id = $1 AND po.role = $2 AND po.is_primary AND po.id <> $3`,
      [projectId, next.role, linkId],
    )).rows[0];
    if (p) throw new HttpError(409, `${p.name} is already the primary ${next.role} on ${cur.project_name}`);
  }
  await q.query(
    `UPDATE project_organizations SET role = $2, is_primary = $3, notes = $4, source = $5, provenance = $6, confidence = $7, updated_by = $8, updated_at = now() WHERE id = $1`,
    [linkId, next.role, next.is_primary, next.notes, next.source, next.provenance, next.confidence, actorId],
  );
  const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => (cur as unknown as Record<string, unknown>)[k] !== v));
  if (Object.keys(changes).length) {
    await logActivity(q, {
      organizationId: cur.organization_id,
      type: "project_link_updated",
      summary: `Project link updated: ${cur.project_name} (${cur.role}${next.role !== cur.role ? ` → ${next.role}` : ""})`,
      details: { project_id: projectId, link_id: linkId, changes },
      actorId,
    });
    await audit(q, actorId, "project_organization", linkId, "update", { before: cur, after: next });
    await logProjectActivity(q, {
      projectId,
      type: "stakeholder_updated",
      summary: `${cur.organization_name}: ${cur.role}${next.role !== cur.role ? ` → ${next.role}` : ""} updated (${Object.keys(changes).join(", ")})`,
      details: { link_id: linkId, changes },
      actorId,
    });
  }
  return getLink(q, projectId, linkId);
}

/**
 * Remove a stakeholder link. The full row is kept in the audit log and the removal is recorded on the
 * organization's timeline, so the history of who was linked is not lost.
 */
export async function removeStakeholder(q: Queryable, projectId: number, linkId: number, actorId: number | null, reason?: string | null): Promise<void> {
  const cur = await getLink(q, projectId, linkId);
  await q.query(`DELETE FROM project_organizations WHERE id = $1`, [linkId]);
  await logActivity(q, {
    organizationId: cur.organization_id,
    type: "project_unlinked",
    summary: `Removed from project ${cur.project_name} as ${cur.role}${reason ? ` (${reason})` : ""}`,
    details: { project_id: projectId, link: cur, reason: reason ?? null },
    actorId,
  });
  await audit(q, actorId, "project_organization", linkId, "delete", { removed: cur, reason: reason ?? null });
  await logProjectActivity(q, {
    projectId,
    type: "stakeholder_removed",
    summary: `${cur.organization_name} removed as ${cur.role}${reason ? ` (${reason})` : ""}`,
    details: { link: cur, reason: reason ?? null },
    actorId,
  });
}

const MERGEABLE_PROJECT_FIELDS = ["project_type", "description", "address", "area", "pincode", "website", "built_up_area_sqft", "building_count", "unit_count", "notes"] as const;

/**
 * Merge a duplicate project into another (always a human decision — never automatic).
 * Empty fields on the target are filled from the duplicate; stakeholders, facts, water opportunities and
 * CRM links move unless they would collide with what the target already has (those stay on the merged
 * record). The duplicate is kept and points to the target via merged_into.
 */
export async function mergeProject(q: Queryable, id: number, targetId: number, actorId: number | null): Promise<Project> {
  if (id === targetId) throw new HttpError(400, "Cannot merge a project into itself");
  const src = await getProject(q, id);
  const target = await getProject(q, targetId);
  if (!src || !target) throw new HttpError(404, "Project not found");
  if (src.merged_into || target.merged_into) throw new HttpError(409, "One of these projects was already merged");
  const fs = { ...target.field_sources };
  const sets: string[] = [];
  const params: unknown[] = [targetId];
  const filled: string[] = [];
  for (const f of MERGEABLE_PROJECT_FIELDS) {
    const t = (target as unknown as Record<string, unknown>)[f];
    const v = (src as unknown as Record<string, unknown>)[f];
    if ((t == null || t === "") && v != null && v !== "") {
      params.push(v);
      sets.push(`${f} = $${params.length}`);
      if (src.field_sources[f]) fs[f] = src.field_sources[f];
      filled.push(f);
    }
  }
  for (const f of ["lifecycle_stage", "scale"] as const) {
    if (target[f] === "Unknown" && src[f] !== "Unknown") {
      params.push(src[f]);
      sets.push(`${f} = $${params.length}`);
      if (src.field_sources[f]) fs[f] = src.field_sources[f];
      filled.push(f);
    }
  }
  if (target.lat == null && src.lat != null) {
    params.push(src.lng, src.lat);
    sets.push(`geom = ST_SetSRID(ST_MakePoint($${params.length - 1}, $${params.length}), 4326)::geography`);
    if (src.field_sources.location) fs.location = src.field_sources.location;
    filled.push("location");
  }
  params.push(JSON.stringify(fs), actorId);
  sets.push(`field_sources = $${params.length - 1}`, `updated_by = $${params.length}`);
  await q.query(`UPDATE projects SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);

  await q.query(
    `UPDATE project_organizations p SET project_id = $2, updated_at = now() WHERE p.project_id = $1 AND NOT EXISTS (
       SELECT 1 FROM project_organizations t WHERE t.project_id = $2 AND t.organization_id = p.organization_id AND t.role = p.role)
       AND NOT (p.is_primary AND EXISTS (SELECT 1 FROM project_organizations t WHERE t.project_id = $2 AND t.role = p.role AND t.is_primary))`,
    [id, targetId],
  );
  await q.query(
    `UPDATE project_facts f SET project_id = $2 WHERE f.project_id = $1 AND (f.retired_at IS NOT NULL OR NOT EXISTS (
       SELECT 1 FROM project_facts t WHERE t.project_id = $2 AND t.fact_key = f.fact_key AND lower(t.value) = lower(f.value) AND t.retired_at IS NULL))`,
    [id, targetId],
  );
  await q.query(
    `UPDATE water_opportunities w SET project_id = $2, updated_at = now() WHERE w.project_id = $1 AND (w.status IN ('rejected','closed') OR NOT EXISTS (
       SELECT 1 FROM water_opportunities t WHERE t.project_id = $2 AND coalesce(t.organization_id, 0) = coalesce(w.organization_id, 0)
          AND t.intervention_type = w.intervention_type AND t.context_key = w.context_key AND t.status NOT IN ('rejected','closed')))`,
    [id, targetId],
  );
  // CRM links move unless the target already has an open opportunity of the same type for the same organization.
  await q.query(
    `UPDATE crm_opportunities c SET project_id = $2, updated_at = now() WHERE c.project_id = $1 AND NOT EXISTS (
       SELECT 1 FROM crm_opportunities t WHERE t.project_id = $2 AND t.organization_id = c.organization_id AND t.opportunity_type = c.opportunity_type
          AND t.status NOT IN ('Converted','Not Interested','Lost','Won') AND c.status NOT IN ('Converted','Not Interested','Lost','Won'))`,
    [id, targetId],
  );
  // Tasks and timeline entries follow their opportunity's project (unchanged when the opportunity stayed behind).
  await q.query(`UPDATE tasks t SET project_id = c.project_id FROM crm_opportunities c WHERE c.id = t.opportunity_id AND t.project_id = $1`, [id]);
  await q.query(`UPDATE activities a SET project_id = c.project_id FROM crm_opportunities c WHERE c.id = a.opportunity_id AND a.project_id = $1`, [id]);
  await q.query(`UPDATE projects SET merged_into = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [id, targetId, actorId]);
  await audit(q, actorId, "project", id, "merged_into", { target: targetId, filled });
  await logProjectActivity(q, { projectId: targetId, type: "project_merged", summary: `Duplicate project “${src.name}” merged in${filled.length ? ` — added ${filled.join(", ")}` : ""}`, details: { merged_project_id: id, filled }, actorId });
  await logProjectActivity(q, { projectId: id, type: "project_merged_into", summary: `Merged into “${target.name}”`, details: { target: targetId }, actorId });
  return (await getProject(q, targetId))!;
}
