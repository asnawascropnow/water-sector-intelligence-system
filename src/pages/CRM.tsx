import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, Droplets, FolderKanban, Search } from "lucide-react";
import { POTENTIAL_LEVELS } from "../../shared/constants";
import type { Opportunity, PipelineStage } from "../../shared/types";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { dueLabel, relativeDays, todayLocal } from "../lib/format";
import { boardColumns, crmFiltered, crmQuery, DEFAULT_PIPELINE_KEY, EMPTY_CRM_FILTERS, findPipeline, isProjectOpportunity, opportunityTitle, type CrmFilterState } from "../lib/crmUtils";
import { useApp } from "../context/AppContext";
import { Avatar, Badge, Button, cx, ErrorNote, Input, PageHeader, potentialTone, Select, Spinner } from "../components/ui";

interface Facets {
  projects: { id: number; name: string; count: number }[];
  types: string[];
  interventions: string[];
}

/** A board card. Project opportunities are labelled and lead with the project, so they cannot be mistaken for relationships. */
function OppCard({ o, onDragStart }: { o: Opportunity; onDragStart: (id: number) => void }) {
  const overdue = o.next_follow_up && o.next_follow_up < todayLocal();
  const project = isProjectOpportunity(o);
  return (
    <Link
      to={`/crm/${o.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(o.id));
        onDragStart(o.id);
      }}
      className={cx(
        "block rounded-lg border bg-[var(--surface)] p-3 shadow-[var(--shadow-card)] hover:shadow-md transition cursor-grab active:cursor-grabbing",
        project ? "border-blue-200 dark:border-blue-900 border-l-4 border-l-blue-500" : "border-[var(--border)] hover:border-[var(--border-strong)]",
      )}
      aria-label={`${project ? "Project opportunity" : "Relationship opportunity"}: ${opportunityTitle(o)}`}
    >
      {project ? (
        <>
          <div className="text-[10px] font-semibold tracking-wider text-blue-700 dark:text-blue-300 uppercase">Project opportunity</div>
          <div className="text-[13px] font-semibold leading-snug mt-0.5">{opportunityTitle(o)}</div>
          <div className="text-xs text-[var(--text-2)] mt-1 flex items-center gap-1 min-w-0">
            <FolderKanban size={11} className="shrink-0 text-[var(--text-3)]" />
            <span className="truncate">{o.project_name}</span>
          </div>
          <div className="text-xs text-[var(--text-3)] mt-0.5 truncate">
            Customer: <span className="text-[var(--text-2)]">{o.organization_name}</span>
            {o.stakeholder_roles?.length ? ` (${o.stakeholder_roles.join(", ")})` : ""}
          </div>
        </>
      ) : (
        <>
          <div className="text-[13px] font-semibold leading-snug">{o.organization_name}</div>
          <div className="text-xs text-[var(--text-3)] mt-0.5">
            {o.opportunity_type !== "Customer" || o.title ? opportunityTitle(o) : o.org_type}
            {o.area ? ` · ${o.area}` : ""}
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-1 mt-2">
        {project && <Badge tone="purple">{o.opportunity_type}</Badge>}
        {o.potential && (
          <Badge tone={potentialTone(o.potential)} title={o.potential_source === "ai" ? "Organization's AI-inferred potential" : "Team's rating"}>
            {o.potential}
            {o.potential_source === "ai" ? " (AI)" : ""}
          </Badge>
        )}
        {o.interventions?.map((i) => (
          <Badge key={i} tone="blue">
            <Droplets size={10} /> {i}
          </Badge>
        ))}
        {o.call_status !== "Not Started" && <Badge>{o.call_status}</Badge>}
        {o.proposal_status !== "Not Started" && <Badge tone="blue">Proposal {o.proposal_status.toLowerCase()}</Badge>}
        {o.pilot_status !== "Not Started" && <Badge tone="green">{project ? "Project pilot" : "Pilot"} {o.pilot_status.toLowerCase()}</Badge>}
      </div>
      {o.next_task_title && (
        <div className="text-[11px] text-[var(--text-2)] mt-2 flex items-center gap-1 min-w-0" title="Next task">
          <CalendarClock size={11} className="shrink-0 text-[var(--text-3)]" />
          <span className="truncate">{o.next_task_title}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-[var(--border)] text-[11px] text-[var(--text-3)]">
        <span className={cx("inline-flex items-center gap-1.5 min-w-0", !o.owner_name && "text-amber-600 font-medium")}>
          {o.owner_name && <Avatar name={o.owner_name} size={18} />}
          <span className="truncate">{o.owner_name ?? "Unassigned"}</span>
        </span>
        <span className={cx("whitespace-nowrap", overdue && "text-red-600 dark:text-red-400 font-medium")}>
          {o.next_follow_up ? `Follow-up: ${dueLabel(o.next_follow_up)}` : `Last: ${relativeDays(o.last_activity_at)}`}
        </span>
      </div>
    </Link>
  );
}

export default function CRM() {
  const { activeUsers, catalog, invalidate, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const pipelineKey = params.get("pipeline") ?? DEFAULT_PIPELINE_KEY;
  const pipeline = findPipeline(catalog?.pipelines, pipelineKey);
  const [filters, setFilters] = useState<CrmFilterState>(EMPTY_CRM_FILTERS);
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 250);
    return () => clearTimeout(t);
  }, [search]);
  // A different pipeline has different stages, types and projects: start its filters fresh.
  useEffect(() => {
    setFilters(EMPTY_CRM_FILTERS);
    setSearch("");
  }, [pipelineKey]);

  const { data: opps, error, setData, loading } = useApi<Opportunity[]>(pipeline ? `/crm${crmQuery(pipeline.key, filters)}` : null);
  const { data: facets } = useApi<Facets>(pipeline ? `/crm/facets?pipeline=${pipeline.key}` : null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { main, outcomes } = useMemo(() => boardColumns(pipeline), [pipeline]);
  const isProject = pipeline?.key === "project";
  const set = <K extends keyof CrmFilterState>(k: K, v: CrmFilterState[K]) => setFilters((f) => ({ ...f, [k]: v }));

  async function move(id: number, status: string) {
    const opp = opps?.find((o) => o.id === id);
    if (!opp || opp.status === status) return;
    setData((d) => d?.map((o) => (o.id === id ? { ...o, status } : o)) ?? d);
    try {
      await api.patch(`/crm/${id}`, { status });
      toast(`${opportunityTitle(opp) === opp.opportunity_type ? opp.organization_name : opportunityTitle(opp)} → ${status}`);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
      invalidate();
    }
  }

  const column = (s: PipelineStage) => {
    const items = (opps ?? []).filter((o) => o.status === s.name);
    const muted = s.is_outcome;
    return (
      <div
        key={s.name}
        data-stage={s.name}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(s.name);
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          const id = Number(e.dataTransfer.getData("text/plain")) || dragging;
          if (id) move(id, s.name);
        }}
        className={cx(
          "w-72 shrink-0 rounded-xl p-2.5 flex flex-col min-h-[calc(100vh-19rem)] border",
          muted ? "bg-gray-50/60 dark:bg-white/[0.02] border-dashed border-[var(--border)]" : "bg-[#eceef2] dark:bg-white/[0.04] border-transparent",
          over === s.name && "ring-2 ring-[var(--accent)]",
        )}
      >
        <div className="flex items-center justify-between px-1.5 pt-0.5 pb-2.5">
          <span className={cx("text-xs font-semibold", muted ? "text-[var(--text-3)]" : "text-[var(--text)]")}>{s.name}</span>
          <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-2)] ring-1 ring-[var(--border)]">{items.length}</span>
        </div>
        <div className="space-y-2 flex-1">
          {items.map((o) => (
            <OppCard key={o.id} o={o} onDragStart={setDragging} />
          ))}
          {!items.length && <div className="rounded-lg border border-dashed border-[var(--border-strong)] py-6 text-center text-xs text-[var(--text-3)]">Drop here</div>}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="CRM — Our opportunities"
        subtitle={
          isProject
            ? "Water opportunities on specific projects, each with its customer organization. Drag a card to change its stage; every change is recorded on the timeline."
            : "Organizations the team is actively working with. Drag a card to change its stage; every change is recorded in the organization's timeline."
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-4" role="tablist" aria-label="Pipeline">
        {(catalog?.pipelines ?? []).map((p) => (
          <button
            key={p.key}
            role="tab"
            aria-selected={pipeline?.key === p.key}
            onClick={() => setParams(p.is_default ? {} : { pipeline: p.key }, { replace: true })}
            className={cx(
              "h-9 rounded-lg px-3.5 text-sm font-medium border transition cursor-pointer",
              pipeline?.key === p.key ? "bg-[var(--accent)] text-white border-transparent shadow-sm" : "bg-[var(--surface)] border-[var(--border-strong)] text-[var(--text-2)] hover:bg-[var(--surface-2)]",
            )}
          >
            {p.key === "project" ? "Project Opportunities" : p.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
          <Input className="pl-9" placeholder="Search organization, project, title, contact, intervention…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search CRM" />
        </div>
        <Select className="!w-auto" value={filters.owner} onChange={(e) => set("owner", e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="All owners" aria-label="Owner" />
        <Select className="!w-auto" value={filters.stage} onChange={(e) => set("stage", e.target.value)} options={(pipeline?.stages ?? []).map((s) => s.name)} placeholder="All stages" aria-label="Stage" />
        <Select className="!w-auto" value={filters.type} onChange={(e) => set("type", e.target.value)} options={facets?.types ?? []} placeholder="All types" aria-label="Opportunity type" />
        <Select className="!w-auto" value={filters.potential} onChange={(e) => set("potential", e.target.value)} options={POTENTIAL_LEVELS} placeholder="Any potential" aria-label="Potential" />
        <Select className="!w-auto" value={filters.intervention} onChange={(e) => set("intervention", e.target.value)} options={facets?.interventions ?? []} placeholder="Any intervention" aria-label="Water intervention" />
        {isProject && (
          <>
            <Select className="!w-auto max-w-[220px]" value={filters.projectId} onChange={(e) => set("projectId", e.target.value)} options={(facets?.projects ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.count})` }))} placeholder="All projects" aria-label="Project" />
            <Select className="!w-auto" value={filters.lifecycle} onChange={(e) => set("lifecycle", e.target.value)} options={catalog?.lifecycleStages ?? []} placeholder="Any project stage" aria-label="Project lifecycle stage" />
          </>
        )}
        {(crmFiltered(filters) || search) && (
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setFilters(EMPTY_CRM_FILTERS);
            }}
          >
            Clear
          </Button>
        )}
      </div>
      <ErrorNote error={error} />
      {!opps || !pipeline ? (
        <Spinner />
      ) : (
        <>
          {!opps.length && !crmFiltered(filters) && (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--text-2)]">
              {isProject ? (
                <>
                  No project opportunities yet. Open a project in <Link to="/projects" className="text-[var(--accent)] hover:underline">Projects</Link> and create one from its CRM tab, or convert an approved water opportunity.
                </>
              ) : (
                <>
                  No opportunities yet. Open an organization on the <Link to="/map" className="text-[var(--accent)] hover:underline">Bengaluru map</Link> or in{" "}
                  <Link to="/organizations" className="text-[var(--accent)] hover:underline">Organizations</Link> and choose “Add to CRM”.
                </>
              )}
            </div>
          )}
          {!opps.length && crmFiltered(filters) && <div className="mb-4 text-sm text-[var(--text-3)]">No opportunities match these filters.</div>}
          <div className={cx("flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0", loading && "opacity-70")} aria-label={`${pipeline.label} board`}>
            {main.map(column)}
            {outcomes.length > 0 && <div className="w-px bg-[var(--border)] shrink-0 mx-1" />}
            {outcomes.map(column)}
          </div>
        </>
      )}
    </>
  );
}
