import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Droplets, FolderKanban, KanbanSquare, Plus, Search } from "lucide-react";
import type { ProjectListItem } from "../../shared/types";
import { useApi } from "../lib/useApi";
import { EMPTY_PROJECT_FILTERS, isFiltered, projectQuery, stageTone, type ProjectFilterState } from "../lib/projectUtils";
import { formatDate } from "../lib/format";
import { useApp } from "../context/AppContext";
import ProjectForm from "../components/project/ProjectForm";
import { Badge, Button, cx, EmptyState, ErrorNote, Input, PageHeader, Select, Spinner } from "../components/ui";

interface Facets {
  areas: string[];
  organizations: { id: number; name: string; org_type: string; project_count: number }[];
}

const PAGE = 50;

export default function Projects() {
  const { catalog } = useApp();
  const [filters, setFilters] = useState<ProjectFilterState>(EMPTY_PROJECT_FILTERS);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  // Debounced search; all filtering happens on the server so only matching projects are loaded.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setLimit(PAGE), [filters]);

  const { data: projects, error, loading } = useApi<ProjectListItem[]>(`/projects${projectQuery(filters)}`);
  const { data: facets } = useApi<Facets>("/projects/facets");
  const set = <K extends keyof ProjectFilterState>(k: K, v: ProjectFilterState[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const filtered = isFiltered(filters);
  const toggleStage = (s: string) => set("stages", filters.stages.includes(s) ? filters.stages.filter((x) => x !== s) : [...filters.stages, s]);

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Construction and development projects in Bengaluru, the organizations involved, and where water interventions may fit."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> New project
          </Button>
        }
      />
      <ErrorNote error={error} />
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
              <Input className="pl-9" placeholder="Search name, area, address, description…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search projects" />
            </div>
            <Select className="!w-auto" value={filters.type} onChange={(e) => set("type", e.target.value)} options={catalog?.projectTypes ?? []} placeholder="All types" aria-label="Project type" />
            <Select className="!w-auto" value={filters.scale} onChange={(e) => set("scale", e.target.value)} options={catalog?.projectScales ?? []} placeholder="Any scale" aria-label="Scale" />
            <Select className="!w-auto" value={filters.area} onChange={(e) => set("area", e.target.value)} options={facets?.areas ?? []} placeholder="All areas" aria-label="Area" />
            <Select
              className="!w-auto max-w-[220px]"
              value={filters.organizationId}
              onChange={(e) => set("organizationId", e.target.value)}
              options={(facets?.organizations ?? []).map((o) => ({ value: o.id, label: `${o.name} (${o.project_count})` }))}
              placeholder="Any organization"
              aria-label="Stakeholder organization"
            />
            <Select className="!w-auto" value={filters.role} onChange={(e) => set("role", e.target.value)} options={catalog?.stakeholderRoles ?? []} placeholder="Any role" aria-label="Stakeholder role" />
            {(filtered || search) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch("");
                  setFilters(EMPTY_PROJECT_FILTERS);
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Lifecycle stage">
            <span className="text-xs text-[var(--text-3)] mr-1">Stage</span>
            {(catalog?.lifecycleStages ?? []).map((s) => {
              const on = filters.stages.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleStage(s)}
                  className={cx(
                    "rounded-full border px-2.5 h-7 text-xs cursor-pointer transition",
                    on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)] font-medium" : "border-[var(--border-strong)] text-[var(--text-2)] hover:bg-[var(--surface-2)]",
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {!projects ? (
          <Spinner />
        ) : !projects.length ? (
          filtered ? (
            <EmptyState title="No projects match these filters" icon={FolderKanban}>
              Try clearing a filter.
            </EmptyState>
          ) : (
            <EmptyState
              title="No projects yet"
              icon={FolderKanban}
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={14} /> Add the first project
                </Button>
              }
            >
              Record a construction or development project, then link its developer, architect, contractor and consultants.
            </EmptyState>
          )
        ) : (
          <div className={cx("overflow-x-auto", loading && "opacity-60")}>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--text-3)] bg-[var(--surface-2)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Project</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 font-medium">Stage</th>
                  <th className="px-3 py-2.5 font-medium">Location</th>
                  <th className="px-3 py-2.5 font-medium">Scale</th>
                  <th className="px-3 py-2.5 font-medium">Key stakeholders</th>
                  <th className="px-3 py-2.5 font-medium" title="Live water opportunities">Water</th>
                  <th className="px-3 py-2.5 font-medium" title="Linked CRM opportunities">CRM</th>
                  <th className="px-3 py-2.5 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {projects.slice(0, limit).map((p) => {
                  const key = p.stakeholders.slice(0, 3);
                  return (
                    <tr key={p.id} className="hover:bg-[var(--surface-2)] align-top">
                      <td className="px-4 py-2.5 max-w-[300px]">
                        <Link to={`/projects/${p.id}`} className="font-medium hover:underline">
                          {p.name}
                        </Link>
                        {p.description && <div className="text-xs text-[var(--text-3)] truncate">{p.description}</div>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{p.project_type ?? <span className="text-[var(--text-3)]">Unknown</span>}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone={stageTone(p.lifecycle_stage)}>{p.lifecycle_stage}</Badge>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {p.area ?? (p.pincode ? p.pincode : <span className="text-[var(--text-3)]">Unknown</span>)}
                        {p.lat == null && <div className="text-[11px] text-amber-700 dark:text-amber-400">No map location</div>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {p.scale !== "Unknown" ? p.scale : <span className="text-[var(--text-3)]">Unknown</span>}
                        {p.unit_count != null && <div className="text-[11px] text-[var(--text-3)]">{p.unit_count.toLocaleString("en-IN")} units</div>}
                      </td>
                      <td className="px-3 py-2.5 text-xs max-w-[260px]">
                        {!key.length ? (
                          <span className="text-[var(--text-3)]">None linked</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {key.map((s) => (
                              <li key={`${s.organization_id}-${s.role}`} className="truncate">
                                <span className="text-[var(--text-3)]">{s.role}:</span>{" "}
                                <Link to={`/organizations/${s.organization_id}`} className="hover:underline">
                                  {s.organization_name}
                                </Link>
                              </li>
                            ))}
                            {p.stakeholder_count > key.length && <li className="text-[var(--text-3)]">+{p.stakeholder_count - key.length} more</li>}
                          </ul>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.water_opportunity_count ? (
                          <Badge tone="blue">
                            <Droplets size={11} /> {p.water_opportunity_count}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[var(--text-3)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {p.crm_opportunity_count ? (
                          <Badge tone="purple">
                            <KanbanSquare size={11} /> {p.crm_opportunity_count}
                          </Badge>
                        ) : (
                          <span className="text-xs text-[var(--text-3)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[var(--text-3)] whitespace-nowrap">{formatDate(p.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-4 py-2.5 text-xs text-[var(--text-3)] border-t border-[var(--border)]">
              <span>
                {Math.min(limit, projects.length)} of {projects.length} shown
              </span>
              {projects.length > limit && (
                <Button size="sm" onClick={() => setLimit(limit + PAGE)}>
                  Show more
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <ProjectForm open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
