import type { Queryable } from "../db";
import { LIFECYCLE_STAGES, PROJECT_SCALES } from "../../shared/constants";
import type { Catalog, FactDefinition, OrganizationTaxonomy, OrganizationTypeMeta, OrganizationView, Pipeline, PipelineStage, WaterIntervention } from "../../shared/types";

/** All configurable vocabularies from the database catalogs (served by GET /api/meta). */
export async function getCatalog(q: Queryable): Promise<Catalog> {
  const names = async (table: string) =>
    (await q.query<{ name: string }>(`SELECT name FROM ${table} WHERE active ORDER BY sort_order, name`)).rows.map((r) => r.name);
  const pipelines = (await q.query<Omit<Pipeline, "stages">>(`SELECT key, label, description, is_default FROM pipelines WHERE active ORDER BY sort_order`)).rows;
  const stages = (
    await q.query<PipelineStage & { pipeline: string }>(`SELECT pipeline, name, sort_order, kind, is_outcome, milestone FROM pipeline_stages ORDER BY pipeline, sort_order`)
  ).rows;
  return {
    organizationTypeGroups: (await q.query<{ key: string; label: string }>(`SELECT key, label FROM organization_type_groups ORDER BY sort_order`)).rows,
    organizationTypes: (
      await q.query(`SELECT name, group_key, description, map_color, sort_order, active FROM organization_types ORDER BY sort_order, name`)
    ).rows,
    projectTypes: await names("project_types"),
    lifecycleStages: [...LIFECYCLE_STAGES],
    projectScales: [...PROJECT_SCALES],
    stakeholderRoles: await names("stakeholder_roles"),
    waterInterventionTypes: await names("water_intervention_types"),
    waterInterventions: (await waterInterventions(q)).filter((w) => w.active),
    opportunityTypes: (await q.query<{ name: string; default_pipeline: string }>(`SELECT name, default_pipeline FROM opportunity_types WHERE active ORDER BY sort_order`)).rows,
    pipelines: pipelines.map((p) => ({ ...p, stages: stages.filter((s) => s.pipeline === p.key).map(({ pipeline: _p, ...s }) => s) })),
    organizationViews: await organizationViews(q),
    factDefinitions: (await q.query<FactDefinition>(`SELECT key, label, applies_to, value_type, allowed_values, multi_valued, type_groups, profiles, unit, description FROM fact_definitions WHERE active ORDER BY applies_to, sort_order`)).rows,
  };
}

/** Water intervention catalog (active and inactive), ordered by group then intervention order then label. */
export async function waterInterventions(q: Queryable): Promise<WaterIntervention[]> {
  const { rows } = await q.query<WaterIntervention>(
    `SELECT t.key, t.name AS label, t.group_key AS "group", g.label AS group_label, t.description, t.sort_order, t.active
       FROM water_intervention_types t JOIN water_intervention_groups g ON g.key = t.group_key
      ORDER BY g.sort_order, t.sort_order, t.name`,
  );
  return rows;
}

/** Active organization type names (case-insensitive lookup → canonical name). */
export async function activeOrganizationTypes(q: Queryable): Promise<Map<string, string>> {
  const { rows } = await q.query<{ name: string }>(`SELECT name FROM organization_types WHERE active`);
  return new Map(rows.map((r) => [r.name.toLowerCase(), r.name]));
}

export async function inCatalog(q: Queryable, table: "project_types" | "stakeholder_roles" | "water_intervention_types" | "opportunity_types", name: string): Promise<boolean> {
  const { rows } = await q.query(`SELECT 1 FROM ${table} WHERE name = $1 AND active`, [name]);
  return rows.length > 0;
}

/** Saved Discover views (Architects, Developers, …) with their member types, in display order. */
export async function organizationViews(q: Queryable): Promise<OrganizationView[]> {
  const { rows } = await q.query<OrganizationView>(
    `SELECT v.key, v.label, v.description,
            coalesce(array_agg(t.name ORDER BY g.sort_order, t.sort_order, t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS types
       FROM organization_views v
       LEFT JOIN organization_view_types vt ON vt.view_key = v.key
       LEFT JOIN organization_types t ON t.name = vt.type_name
       LEFT JOIN organization_type_groups g ON g.key = t.group_key
      WHERE v.active
      GROUP BY v.key, v.label, v.description, v.sort_order
      ORDER BY v.sort_order, v.key`,
  );
  return rows;
}

/** Member types of one active view, or null if the view does not exist. */
export async function viewTypes(q: Queryable, key: string): Promise<string[] | null> {
  const v = (await organizationViews(q)).find((x) => x.key === key);
  return v ? v.types : null;
}

/**
 * Organization taxonomy for the UI: groups, every catalog type (active and inactive/legacy) ordered by
 * group then type sort order then name, and the saved views.
 */
export async function organizationTaxonomy(q: Queryable): Promise<OrganizationTaxonomy> {
  const groups = (await q.query<{ key: string; label: string; sort_order: number }>(`SELECT key, label, sort_order FROM organization_type_groups ORDER BY sort_order, key`)).rows;
  const types = (
    await q.query<OrganizationTypeMeta>(
      `SELECT t.name AS key, t.name AS label, t.group_key AS "group", g.label AS group_label, t.sort_order, t.active, t.map_color, t.description
         FROM organization_types t JOIN organization_type_groups g ON g.key = t.group_key
        ORDER BY g.sort_order, t.sort_order, t.name`,
    )
  ).rows;
  return { groups, types, views: await organizationViews(q) };
}
