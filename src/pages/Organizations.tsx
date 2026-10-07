import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Building2, Plus, Search, Upload } from "lucide-react";
import { ORG_TYPE_COLORS, POTENTIAL_LEVELS } from "../../shared/constants";
import type { Organization } from "../../shared/types";
import { useApi } from "../lib/useApi";
import { EMPTY_FILTERS, useOrgFilters } from "../lib/orgFilters";
import { formatDate } from "../lib/format";
import OrganizationForm from "../components/org/OrganizationForm";
import AddToCrmDialog from "../components/org/AddToCrmDialog";
import TypeFilter from "../components/org/TypeFilter";
import { useApp } from "../context/AppContext";
import { Badge, Button, confidenceTone, EmptyState, ErrorNote, Input, PageHeader, PotentialBadge, Select, Spinner, statusTone } from "../components/ui";

export default function Organizations() {
  const { taxonomy } = useApp();
  const { data: orgs, error } = useApi<Organization[]>("/organizations");
  const { filters, setFilters, filtered, areas, active, reset } = useOrgFilters(orgs);
  const [creating, setCreating] = useState(false);
  const [crmOrg, setCrmOrg] = useState<Organization | null>(null);
  const [limit, setLimit] = useState(100);

  // Saved Discover views (/organizations?view=architects): the view's catalog types become the type
  // filter. Other filters still apply on top; picking different types leaves the view.
  const [params, setParams] = useSearchParams();
  const viewKey = params.get("view");
  const view = viewKey ? taxonomy?.views.find((v) => v.key === viewKey) ?? null : null;
  const viewTypesKey = view ? view.types.join("|") : "";
  // Entering a view (or going back to all Organizations from the sidebar) starts from a clean filter
  // set. Leaving a view because the user picked different types keeps their selection.
  const keepFilters = useRef(false);
  useEffect(() => {
    if (keepFilters.current) {
      keepFilters.current = false;
      return;
    }
    if (viewKey && !view) return; // taxonomy still loading
    setFilters({ ...EMPTY_FILTERS, types: view ? view.types : [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, viewTypesKey]);
  const setTypes = (types: string[]) => {
    setFilters((f) => ({ ...f, types }));
    if (viewKey) {
      keepFilters.current = true;
      setParams({}, { replace: true });
    }
  };
  const clearAll = () => {
    reset();
    if (viewKey) setParams({}, { replace: true });
  };

  return (
    <>
      <PageHeader
        eyebrow={view ? "Organizations · saved view" : undefined}
        title={view ? view.label : "Organizations"}
        subtitle={
          view
            ? `${view.description ?? ""}${view.description ? ". " : ""}Includes: ${view.types.join(", ")}.`
            : viewKey && taxonomy
              ? `Unknown view "${viewKey}". Showing all organizations.`
              : "The Bengaluru organization database. An organization only becomes a CRM opportunity when we decide to work on it."
        }
        actions={
          <>
            <Link to="/import">
              <Button>
                <Upload size={14} /> Import data
              </Button>
            </Link>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Add organization
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />
      {!orgs ? (
        <Spinner />
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] overflow-hidden">
      <div className="flex flex-wrap gap-2 p-4 border-b border-[var(--border)]">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-3)] pointer-events-none" />
            <Input className="pl-9" placeholder="Search name, area, address, sector…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <TypeFilter taxonomy={taxonomy} organizations={orgs} value={filters.types} onChange={setTypes} viewLabel={view?.label} />
          <Select className="!w-auto" value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })} options={areas} placeholder="All areas" aria-label="Area" />
          <Select
            className="!w-auto"
            value={filters.crm}
            onChange={(e) => setFilters({ ...filters, crm: e.target.value as "" | "in" | "out" })}
            options={[
              { value: "out", label: "Not in CRM" },
              { value: "in", label: "In CRM" },
            ]}
            placeholder="CRM: any"
            aria-label="CRM"
          />
          <Select className="!w-auto" value={filters.potential} onChange={(e) => setFilters({ ...filters, potential: e.target.value })} options={POTENTIAL_LEVELS} placeholder="Any potential" aria-label="Potential" />
          {(active || viewKey) && (
            <Button variant="ghost" onClick={clearAll}>
              Clear
            </Button>
          )}
        </div>
            <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--text-3)] bg-[var(--surface-2)] border-b border-[var(--border)]">
              <tr>
                <th className="px-4 py-2.5 font-medium">Organization</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Area</th>
                <th className="px-3 py-2.5 font-medium">Contact</th>
                <th className="px-3 py-2.5 font-medium">Potential</th>
                <th className="px-3 py-2.5 font-medium">Confidence</th>
                <th className="px-3 py-2.5 font-medium">CRM</th>
                <th className="px-3 py-2.5 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.slice(0, limit).map((o) => (
                <tr key={o.id} className="hover:bg-[var(--surface-2)]">
                  <td className="px-4 py-2.5 max-w-[320px]">
                    <Link to={`/organizations/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                    <div className="text-xs text-[var(--text-3)] truncate">{o.sector ?? o.address ?? ""}</div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: ORG_TYPE_COLORS[o.org_type] ?? ORG_TYPE_COLORS.Other }} />
                      {o.org_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{o.area ?? <span className="text-[var(--text-3)]">Unknown</span>}</td>
                  <td className="px-3 py-2.5 text-xs">{o.phone || o.email ? <span>{o.phone ?? o.email}</span> : <span className="text-[var(--text-3)]">Unknown</span>}</td>
                  <td className="px-3 py-2.5">
                    <PotentialBadge potential={o.intelligence?.potential} short />
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={confidenceTone(o.data_confidence)} title={o.source_label ?? undefined}>
                      {o.data_confidence}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {o.crm_status ? (
                      <Badge tone={statusTone(o.crm_status)}>{o.crm_status}</Badge>
                    ) : o.project_opportunity_count ? (
                      <Badge tone="blue" title="Project opportunities only — no organization-level relationship yet">
                        {o.project_opportunity_count} project {o.project_opportunity_count === 1 ? "opp." : "opps."}
                      </Badge>
                    ) : (
                      <button onClick={() => setCrmOrg(o)} className="text-xs text-[var(--accent)] hover:underline cursor-pointer">
                        Add to CRM
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-3)] whitespace-nowrap">{formatDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {!filtered.length && <EmptyState title={view ? `No ${view.label.toLowerCase()} yet` : "No organizations match"} icon={Building2}>{view ? "Add one manually with one of these types, or import a file." : "Try clearing filters, add one manually, or import a file."}</EmptyState>}
          <div className="flex items-center justify-between px-4 py-2.5 text-xs text-[var(--text-3)] border-t border-[var(--border)]">
            <span>
              {Math.min(limit, filtered.length)} of {filtered.length} shown
            </span>
            {filtered.length > limit && (
              <Button size="sm" onClick={() => setLimit(limit + 200)}>
                Show more
              </Button>
            )}
          </div>
        </div>
      )}
      <OrganizationForm open={creating} onClose={() => setCreating(false)} />
      <AddToCrmDialog org={crmOrg} onClose={() => setCrmOrg(null)} stayOnPage />
    </>
  );
}
