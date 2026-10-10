import type { Queryable } from "../db";
import { FACT_PROVENANCE, type FactProvenance } from "../../shared/constants";
import type { Fact, FactDefinition } from "../../shared/types";
import { HttpError } from "./http";
import { audit, logActivity, logProjectActivity } from "./log";

type Entity = "organization" | "project";
const TABLE: Record<Entity, { table: string; fk: string; parent: string }> = {
  organization: { table: "organization_facts", fk: "organization_id", parent: "organizations" },
  project: { table: "project_facts", fk: "project_id", parent: "projects" },
};

export interface FactInput {
  key: string;
  value: unknown;
  provenance: FactProvenance;
  confidence?: "High" | "Medium" | "Low" | "Unknown";
  source?: string | null;
  sourceId?: number | null;
  note?: string | null;
  /** Internal: id of the fact this one supersedes (set by changeFact). */
  replacesFactId?: number | null;
}

/** Validate and canonicalise a value against its definition. Never coerces missing data into a value. */
export function canonicalFactValue(def: FactDefinition, raw: unknown): string {
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) throw new HttpError(400, `A value is required for "${def.label}"`);
  const s = typeof raw === "string" ? raw.trim() : String(raw);
  switch (def.value_type) {
    case "boolean": {
      if (raw === true || /^(true|yes|y)$/i.test(s)) return "Yes";
      if (raw === false || /^(false|no|n)$/i.test(s)) return "No";
      throw new HttpError(400, `"${def.label}" must be yes or no`);
    }
    case "number": {
      const n = typeof raw === "number" ? raw : Number(s.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `"${def.label}" must be a non-negative number`);
      return String(n);
    }
    case "level":
    case "enum": {
      const match = (def.allowed_values ?? []).find((v) => v.toLowerCase() === s.toLowerCase());
      if (!match) throw new HttpError(400, `"${s}" is not a valid value for "${def.label}" (allowed: ${(def.allowed_values ?? []).join(", ")})`);
      return match;
    }
    default:
      if (s.length > 2000) throw new HttpError(400, `"${def.label}" is too long`);
      return s;
  }
}

async function definition(q: Queryable, entity: Entity, key: string): Promise<FactDefinition> {
  const { rows } = await q.query<FactDefinition & { active: boolean }>(`SELECT * FROM fact_definitions WHERE key = $1`, [key]);
  const def = rows[0];
  if (!def || !def.active) throw new HttpError(400, `Unknown fact "${key}"`);
  if (def.applies_to !== entity) throw new HttpError(400, `Fact "${key}" applies to ${def.applies_to}s, not ${entity}s`);
  return def;
}

export interface AddFactResult {
  fact: Fact;
  /** Facts retired because a single-valued fact was replaced. */
  retired: number[];
  /** Non-blocking notes, e.g. fact meant for a different organization type group. */
  warnings: string[];
}

/**
 * Record a sourced fact on an organization or project.
 * - Single-valued facts: a new value retires the previous active one (history is kept).
 * - Multi-valued facts: the same value twice is a conflict.
 * - Anything not Verified must cite a source (also enforced by the database).
 */
export async function addFact(q: Queryable, entity: Entity, entityId: number, input: FactInput, actorId: number | null): Promise<AddFactResult> {
  const t = TABLE[entity];
  const parent = (await q.query<{ name: string; merged_into: number | null; group_key?: string }>(
    entity === "organization"
      ? `SELECT o.name, o.merged_into, ot.group_key FROM organizations o JOIN organization_types ot ON ot.name = o.org_type WHERE o.id = $1`
      : `SELECT name, merged_into FROM projects WHERE id = $1`,
    [entityId],
  )).rows[0];
  if (!parent) throw new HttpError(404, `${entity === "organization" ? "Organization" : "Project"} not found`);
  if (parent.merged_into) throw new HttpError(409, `This ${entity} was merged into #${parent.merged_into}`);

  const def = await definition(q, entity, input.key);
  const value = canonicalFactValue(def, input.value);
  if (!FACT_PROVENANCE.includes(input.provenance)) throw new HttpError(400, "Provenance must be Verified, Unverified, Estimated or AI Inference");
  if (input.confidence !== undefined && !["High", "Medium", "Low", "Unknown"].includes(input.confidence)) throw new HttpError(400, "Confidence must be High, Medium, Low or Unknown");
  const source = input.source?.trim() || null;
  if (input.provenance !== "Verified" && !source && !input.sourceId) throw new HttpError(400, "Unverified, estimated and AI-inferred facts must cite a source");

  const warnings: string[] = [];
  if (entity === "organization" && def.type_groups && parent.group_key && !def.type_groups.includes(parent.group_key)) {
    warnings.push(`"${def.label}" is meant for ${def.type_groups.join(" / ").replace(/_/g, " ")} organizations`);
  }

  const active = (await q.query<{ id: number; value: string }>(`SELECT id, value FROM ${t.table} WHERE ${t.fk} = $1 AND fact_key = $2 AND retired_at IS NULL`, [entityId, def.key])).rows;
  if (active.some((f) => f.value.toLowerCase() === value.toLowerCase())) throw new HttpError(409, `"${def.label}" already has the value "${value}"`);
  const retired: number[] = [];
  if (!def.multi_valued && active.length) {
    for (const f of active) retired.push(f.id);
    await q.query(`UPDATE ${t.table} SET retired_at = now(), retired_by = $2 WHERE id = ANY($1::int[])`, [retired, actorId]);
  }

  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO ${t.table} (${t.fk}, fact_key, value, note, source, source_id, provenance, confidence, created_by, replaces_fact_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [entityId, def.key, value, input.note?.trim() || null, source, input.sourceId ?? null, input.provenance, input.confidence ?? "Unknown", actorId, input.replacesFactId ?? null],
  );
  const id = rows[0].id;
  if (entity === "organization") {
    await logActivity(q, {
      organizationId: entityId,
      type: "fact_added",
      summary: `${input.replacesFactId ? "Changed " : ""}${def.label}: ${value}${def.unit ? ` ${def.unit}` : ""} (${input.provenance}${source ? `, source: ${source}` : ""})`,
      details: { fact_id: id, key: def.key, value, retired },
      actorId,
    });
  }
  if (entity === "project") {
    await logProjectActivity(q, {
      projectId: entityId,
      type: input.replacesFactId ? "fact_changed" : "fact_added",
      summary: `${input.replacesFactId ? "Changed " : ""}${def.label}: ${value}${def.unit ? ` ${def.unit}` : ""} (${input.provenance}${source ? `, source: ${source}` : ""})`,
      details: { fact_id: id, key: def.key, value, retired },
      actorId,
    });
  }
  await audit(q, actorId, t.table, id, "create", { key: def.key, value, provenance: input.provenance, source, retired });
  return { fact: (await listFacts(q, entity, entityId, { includeRetired: true })).find((f) => f.id === id)!, retired, warnings };
}

/** Withdraw a fact (kept for history). */
export async function retireFact(q: Queryable, entity: Entity, factId: number, actorId: number | null): Promise<void> {
  const t = TABLE[entity];
  const { rows } = await q.query<{ id: number; parent: number; fact_key: string; value: string }>(
    `UPDATE ${t.table} SET retired_at = now(), retired_by = $2 WHERE id = $1 AND retired_at IS NULL RETURNING id, ${t.fk} AS parent, fact_key, value`,
    [factId, actorId],
  );
  if (!rows.length) throw new HttpError(404, "Active fact not found");
  const label = (await q.query<{ label: string }>(`SELECT label FROM fact_definitions WHERE key = $1`, [rows[0].fact_key])).rows[0]?.label ?? rows[0].fact_key;
  const summary = `Withdrew ${label}: ${rows[0].value}`;
  if (entity === "project") await logProjectActivity(q, { projectId: rows[0].parent, type: "fact_withdrawn", summary, details: { fact_id: factId }, actorId });
  else await logActivity(q, { organizationId: rows[0].parent, type: "fact_withdrawn", summary, details: { fact_id: factId }, actorId });
  await audit(q, actorId, t.table, factId, "retire");
}

export async function listFacts(q: Queryable, entity: Entity, entityId: number, opts: { includeRetired?: boolean } = {}): Promise<Fact[]> {
  const t = TABLE[entity];
  const { rows } = await q.query<Fact>(
    `SELECT f.id, f.fact_key, d.label, f.value, f.note, f.source, f.provenance, f.confidence, u.name AS created_by_name, f.created_at, f.retired_at, f.replaces_fact_id
       FROM ${t.table} f JOIN fact_definitions d ON d.key = f.fact_key LEFT JOIN users u ON u.id = f.created_by
      WHERE f.${t.fk} = $1 AND ($2 OR f.retired_at IS NULL)
      ORDER BY d.sort_order, f.created_at`,
    [entityId, Boolean(opts.includeRetired)],
  );
  return rows;
}

/**
 * Change a fact (value, provenance, confidence, source or note). Facts are versioned, never edited in
 * place: the current row is retired and a new row is created with replaces_fact_id pointing to it, so
 * the earlier value and where it came from stay on record. Fields not supplied keep their old values.
 */
export async function changeFact(
  q: Queryable,
  entity: Entity,
  entityId: number,
  factId: number,
  changes: Partial<Omit<FactInput, "key" | "replacesFactId">>,
  actorId: number | null,
): Promise<AddFactResult> {
  const t = TABLE[entity];
  const old = (await q.query<{ id: number; fact_key: string; value: string; note: string | null; source: string | null; source_id: number | null; provenance: FactProvenance; confidence: FactInput["confidence"]; retired_at: string | null }>(
    `SELECT id, fact_key, value, note, source, source_id, provenance, confidence, retired_at FROM ${t.table} WHERE id = $1 AND ${t.fk} = $2`,
    [factId, entityId],
  )).rows[0];
  if (!old) throw new HttpError(404, "Fact not found");
  if (old.retired_at) throw new HttpError(409, "This fact was already replaced or withdrawn");
  const next: FactInput = {
    key: old.fact_key,
    value: changes.value !== undefined ? changes.value : old.value,
    provenance: changes.provenance ?? old.provenance,
    confidence: changes.confidence ?? old.confidence,
    source: changes.source !== undefined ? changes.source : old.source,
    sourceId: changes.sourceId !== undefined ? changes.sourceId : old.source_id,
    note: changes.note !== undefined ? changes.note : old.note,
    replacesFactId: old.id,
  };
  const def = await definition(q, entity, old.fact_key);
  const same =
    canonicalFactValue(def, next.value) === old.value &&
    next.provenance === old.provenance &&
    next.confidence === old.confidence &&
    (next.source?.trim() || null) === old.source &&
    (next.note?.trim() || null) === old.note;
  if (same) throw new HttpError(400, "Nothing to change");
  await q.query(`UPDATE ${t.table} SET retired_at = now(), retired_by = $2 WHERE id = $1`, [old.id, actorId]);
  const r = await addFact(q, entity, entityId, next, actorId);
  return { ...r, retired: [old.id, ...r.retired] };
}
