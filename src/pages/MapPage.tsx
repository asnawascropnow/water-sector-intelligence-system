import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { ORG_TYPE_COLORS, ORG_TYPES, POTENTIAL_LEVELS } from "../../shared/constants";
import type { Organization } from "../../shared/types";
import { useApi } from "../lib/useApi";
import { useOrgFilters } from "../lib/orgFilters";
import BengaluruMap from "../components/map/BengaluruMap";
import AddToCrmDialog from "../components/org/AddToCrmDialog";
import { cx, ErrorNote, Input, Select, Spinner } from "../components/ui";

export default function MapPage() {
  const { data: orgs, error } = useApi<Organization[]>("/organizations");
  const { filters, setFilters, filtered, areas, active, reset } = useOrgFilters(orgs);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [crmOrg, setCrmOrg] = useState<Organization | null>(null);
  const located = filtered.filter((o) => o.lat != null);
  const unlocated = filtered.length - located.length;
  const typeCounts = new Map<string, number>();
  for (const o of orgs ?? []) typeCounts.set(o.org_type, (typeCounts.get(o.org_type) ?? 0) + 1);
  const toggleType = (t: (typeof ORG_TYPES)[number]) =>
    setFilters((f) => ({ ...f, types: f.types.includes(t) ? f.types.filter((x) => x !== t) : [...f.types, t] }));

  return (
    <div className="flex flex-col md:flex-row h-[calc(100vh-4rem)] overflow-hidden">
      <aside className="md:w-[22rem] min-w-0 shrink-0 border-b md:border-b-0 md:border-r border-[var(--border)] bg-[var(--surface)] flex flex-col max-h-[45vh] md:max-h-none">
        <div className="p-4 space-y-3 border-b border-[var(--border)]">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Bengaluru Map</h1>
            <p className="text-xs text-[var(--text-3)]">All discovered organizations · Bengaluru, Karnataka, India</p>
          </div>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
            <Input className="pl-9" placeholder="Search name, area, sector…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select className="col-span-2 min-w-0" value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })} options={areas} placeholder="All areas" aria-label="Area" />
            <Select
              className="min-w-0"
              value={filters.crm}
              onChange={(e) => setFilters({ ...filters, crm: e.target.value as "" | "in" | "out" })}
              options={[
                { value: "out", label: "Not in CRM" },
                { value: "in", label: "In CRM" },
              ]}
              placeholder="CRM: any"
              aria-label="CRM status"
            />
            <Select className="min-w-0" value={filters.potential} onChange={(e) => setFilters({ ...filters, potential: e.target.value })} options={POTENTIAL_LEVELS} placeholder="Potential: any" aria-label="Potential" />
          </div>
        </div>
        <div className="p-4 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-[var(--text-3)] uppercase tracking-wide">Organization type</span>
            {active && (
              <button onClick={reset} className="text-xs text-[var(--accent)] hover:underline cursor-pointer">
                Clear filters
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ORG_TYPES.map((t) => {
              const on = filters.types.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={cx(
                    "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs cursor-pointer transition",
                    on ? "border-neutral-900 dark:border-white bg-neutral-900 dark:bg-white text-white dark:text-neutral-900" : "border-[var(--border-strong)] text-[var(--text-2)]",
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: ORG_TYPE_COLORS[t] }} />
                  {t}
                  <span className="tabular-nums opacity-60">{typeCounts.get(t) ?? 0}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--text-3)] mt-2">Outlined markers are organizations already in the CRM.</p>
        </div>
        <div className="px-4 py-2 text-xs text-[var(--text-3)] border-b border-[var(--border)]">
          {located.length} on map
          {unlocated > 0 && ` · ${unlocated} without a known location`}
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
          {filtered.slice(0, 300).map((o) => (
            <li key={o.id}>
              <button
                onClick={() => (o.lat != null ? setFocusId(o.id) : undefined)}
                className={cx("w-full text-left px-4 py-2 hover:bg-[var(--surface-2)]", o.lat != null ? "cursor-pointer" : "cursor-default")}
              >
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: ORG_TYPE_COLORS[o.org_type] }} />
                  <span className="text-sm truncate">{o.name}</span>
                </div>
                <div className="text-xs text-[var(--text-3)] ml-4 truncate">
                  {o.area ?? "Area unknown"} · {o.crm_status ?? "Not contacted"}
                  {o.lat == null && (
                    <>
                      {" · "}
                      <Link to={`/organizations/${o.id}`} className="text-amber-600 hover:underline">
                        location unknown
                      </Link>
                    </>
                  )}
                </div>
              </button>
            </li>
          ))}
          {filtered.length > 300 && <li className="px-4 py-2 text-xs text-[var(--text-3)]">Showing first 300 — refine your search</li>}
        </ul>
      </aside>
      <div className="flex-1 relative min-h-[50vh]">
        <ErrorNote error={error} />
        {orgs ? <BengaluruMap organizations={filtered} focusId={focusId} onAddToCrm={setCrmOrg} className="absolute inset-0" /> : <Spinner />}
      </div>
      <AddToCrmDialog org={crmOrg} onClose={() => setCrmOrg(null)} />
    </div>
  );
}
