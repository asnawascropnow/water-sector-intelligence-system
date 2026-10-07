// Pure helpers for the Projects / intelligence UI. No React or DOM, so they are unit-tested directly.
import type { Fact, FactDefinition, OrganizationTaxonomy, ProjectStakeholder } from "../../shared/types";

export interface ProjectFilterState {
  q: string;
  stages: string[];
  type: string;
  scale: string;
  area: string;
  organizationId: string;
  role: string;
}
export const EMPTY_PROJECT_FILTERS: ProjectFilterState = { q: "", stages: [], type: "", scale: "", area: "", organizationId: "", role: "" };

/** Query string for GET /api/projects (server-side filtering — only matching projects are loaded). */
export function projectQuery(f: ProjectFilterState): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.stages.length) p.set("stage", f.stages.join(","));
  if (f.type) p.set("type", f.type);
  if (f.scale) p.set("scale", f.scale);
  if (f.area) p.set("area", f.area);
  if (f.organizationId) p.set("organization_id", f.organizationId);
  if (f.role) p.set("role", f.role);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const isFiltered = (f: ProjectFilterState) => Boolean(f.q.trim() || f.stages.length || f.type || f.scale || f.area || f.organizationId || f.role);

/** Stakeholders grouped by role, in the catalog's role order; roles without stakeholders are omitted. */
export function groupStakeholders(stakeholders: ProjectStakeholder[], roleOrder: string[]): { role: string; items: ProjectStakeholder[] }[] {
  const rank = (r: string) => {
    const i = roleOrder.indexOf(r);
    return i === -1 ? roleOrder.length : i;
  };
  const roles = [...new Set(stakeholders.map((s) => s.role))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return roles.map((role) => ({
    role,
    items: stakeholders.filter((s) => s.role === role).sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.organization_name.localeCompare(b.organization_name)),
  }));
}

/** Intelligence profiles (saved views like architects / developers / contractors) that include this organization type. */
export function profilesForType(orgType: string, taxonomy: OrganizationTaxonomy | null): { key: string; label: string }[] {
  return (taxonomy?.views ?? []).filter((v) => v.types.includes(orgType)).map((v) => ({ key: v.key, label: v.label }));
}

/**
 * Fact definitions to offer for an organization: those whose profiles intersect the organization's
 * profiles. Facts already recorded are always shown, even if the organization's type changed since.
 */
export function definitionsForOrganization(defs: FactDefinition[], profileKeys: string[], facts: Fact[]): FactDefinition[] {
  const recorded = new Set(facts.map((f) => f.fact_key));
  return defs.filter((d) => d.applies_to === "organization" && ((d.profiles ?? []).some((p) => profileKeys.includes(p)) || recorded.has(d.key)));
}

/** Show the Built Environment Intelligence section only when the organization type has a profile, or facts exist. */
export function showsIntelligence(orgType: string, taxonomy: OrganizationTaxonomy | null, defs: FactDefinition[], facts: Fact[]): boolean {
  const keys = profilesForType(orgType, taxonomy).map((p) => p.key);
  return facts.length > 0 || defs.some((d) => d.applies_to === "organization" && (d.profiles ?? []).some((p) => keys.includes(p)));
}

/** Active facts grouped by definition, in definition order. */
export function groupFacts(facts: Fact[], defs: FactDefinition[]): { def: FactDefinition; facts: Fact[] }[] {
  return defs.map((def) => ({ def, facts: facts.filter((f) => f.fact_key === def.key && !f.retired_at) })).filter((g) => g.facts.length);
}

/** Older versions of a fact, following replaces_fact_id back through the history (newest first). */
export function factHistory(fact: Fact, all: Fact[]): Fact[] {
  const out: Fact[] = [];
  let cur: Fact | undefined = fact;
  const seen = new Set<number>();
  while (cur?.replaces_fact_id && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = all.find((f) => f.id === cur!.replaces_fact_id);
    if (cur) out.push(cur);
  }
  return out;
}

export function formatFactValue(value: string, def?: Pick<FactDefinition, "unit" | "value_type">): string {
  if (def?.value_type === "number") {
    const n = Number(value);
    const s = Number.isFinite(n) ? n.toLocaleString("en-IN") : value;
    return def.unit ? `${s} ${def.unit}` : s;
  }
  return value;
}

export const STAGE_ORDER = ["Concept", "Design", "Approval", "Tender", "Construction", "Commissioning", "Completed", "Operations", "Unknown"];
/** Early stages are when water interventions are easiest to introduce. */
export const stageTone = (stage: string): "blue" | "green" | "amber" | "neutral" =>
  ["Concept", "Design", "Approval", "Tender"].includes(stage) ? "blue" : stage === "Construction" || stage === "Commissioning" ? "amber" : stage === "Unknown" ? "neutral" : "green";
