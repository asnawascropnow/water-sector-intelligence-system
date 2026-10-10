import type { Opportunity, Pipeline, PipelineStage } from "../../shared/types";

/**
 * CRM UI helpers. Pipelines and stages always come from the database catalog (GET /api/meta) — the two
 * pipeline definitions are never hard-coded in components.
 */

export const DEFAULT_PIPELINE_KEY = "relationship";

/** Board columns for a pipeline: the main track in order, then the outcome stages (Not Interested, Lost, Nurture…). */
export function boardColumns(p: Pipeline | undefined): { main: PipelineStage[]; outcomes: PipelineStage[] } {
  const stages = [...(p?.stages ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  return { main: stages.filter((s) => !s.is_outcome), outcomes: stages.filter((s) => s.is_outcome) };
}

export function findPipeline(pipelines: Pipeline[] | undefined, key: string | null | undefined): Pipeline | undefined {
  return pipelines?.find((p) => p.key === key) ?? pipelines?.find((p) => p.is_default) ?? pipelines?.[0];
}

/** The neighbouring main-track stage (for "previous / next stage" buttons); null at either end or from an outcome. */
export function neighbourStage(p: Pipeline | undefined, current: string, step: 1 | -1): string | null {
  const { main } = boardColumns(p);
  const i = main.findIndex((s) => s.name === current);
  if (i === -1) return null;
  return main[i + step]?.name ?? null;
}

export function stageKind(p: Pipeline | undefined, stage: string): PipelineStage["kind"] | null {
  return p?.stages.find((s) => s.name === stage)?.kind ?? null;
}

export const isProjectOpportunity = (o: Pick<Opportunity, "pipeline">) => o.pipeline === "project";

/** Display title: the recorded title, else "<type> — <project>" for project opportunities, else the type. */
export function opportunityTitle(o: Pick<Opportunity, "title" | "opportunity_type" | "project_name" | "pipeline">): string {
  if (o.title) return o.title;
  if (isProjectOpportunity(o) && o.project_name) return `${o.opportunity_type} — ${o.project_name}`;
  return o.opportunity_type;
}

export interface CrmFilterState {
  q: string;
  owner: string;
  type: string;
  potential: string;
  stage: string;
  projectId: string;
  intervention: string;
  lifecycle: string;
}
export const EMPTY_CRM_FILTERS: CrmFilterState = { q: "", owner: "", type: "", potential: "", stage: "", projectId: "", intervention: "", lifecycle: "" };

/** Query string for GET /api/crm — every filter is applied on the server and they combine (AND). */
export function crmQuery(pipeline: string, f: CrmFilterState): string {
  const p = new URLSearchParams({ pipeline });
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.owner) p.set("owner", f.owner);
  if (f.type) p.set("type", f.type);
  if (f.potential) p.set("potential", f.potential);
  if (f.stage) p.set("stage", f.stage);
  if (f.projectId) p.set("project_id", f.projectId);
  if (f.intervention) p.set("intervention", f.intervention);
  if (f.lifecycle && pipeline === "project") p.set("lifecycle", f.lifecycle);
  return `?${p.toString()}`;
}

export const crmFiltered = (f: CrmFilterState) => Object.values(f).some(Boolean);

/** Split an organization's opportunities: its own relationships vs. its project opportunities (never mixed). */
export function splitOpportunities<T extends Pick<Opportunity, "pipeline">>(items: T[]): { relationship: T[]; project: T[] } {
  return { relationship: items.filter((o) => !isProjectOpportunity(o)), project: items.filter(isProjectOpportunity) };
}
