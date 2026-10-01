import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { ORG_TYPE_COLORS, ORG_TYPES, POTENTIAL_LEVELS, type OrgType } from "../../shared/constants";
import type { Organization } from "../../shared/types";
import { useApi } from "../lib/useApi";
import { useOrgFilters } from "../lib/orgFilters";
import { formatDate } from "../lib/format";
import OrganizationForm from "../components/org/OrganizationForm";
import AddToCrmDialog from "../components/org/AddToCrmDialog";
import { Badge, Button, confidenceTone, EmptyState, ErrorNote, Input, PageHeader, PotentialBadge, Select, Spinner, statusTone } from "../components/ui";

export default function Organizations() {
  const { data: orgs, error } = useApi<Organization[]>("/organizations");
  const { filters, setFilters, filtered, areas, active, reset } = useOrgFilters(orgs);
  const [creating, setCreating] = useState(false);
  const [crmOrg, setCrmOrg] = useState<Organization | null>(null);
  const [limit, setLimit] = useState(100);

  return (
    <>
      <PageHeader
        title="Organizations"
        subtitle="The Bengaluru organization database. An organization only becomes a CRM opportunity when we decide to work on it."
        actions={
          <>
            <Link to="/import">
              <Button>Import data</Button>
            </Link>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Add organization
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
          <Input className="pl-8" placeholder="Search name, area, address, sector…" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </div>
        <Select className="!w-auto" value={filters.types[0] ?? ""} onChange={(e) => setFilters({ ...filters, types: e.target.value ? [e.target.value as OrgType] : [] })} options={ORG_TYPES} placeholder="All types" aria-label="Type" />
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
        {active && (
          <Button variant="ghost" onClick={reset}>
            Clear
          </Button>
        )}
      </div>
      <ErrorNote error={error} />
      {!orgs ? (
        <Spinner />
      ) : (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">Organization</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Area</th>
                <th className="px-3 py-2.5 font-medium">Contact</th>
                <th className="px-3 py-2.5 font-medium">Potential</th>
                <th className="px-3 py-2.5 font-medium">Data</th>
                <th className="px-3 py-2.5 font-medium">CRM</th>
                <th className="px-3 py-2.5 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
              {filtered.slice(0, limit).map((o) => (
                <tr key={o.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
                  <td className="px-4 py-2.5 max-w-[320px]">
                    <Link to={`/organizations/${o.id}`} className="font-medium hover:underline">
                      {o.name}
                    </Link>
                    <div className="text-xs text-neutral-500 truncate">{o.sector ?? o.address ?? ""}</div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: ORG_TYPE_COLORS[o.org_type] }} />
                      {o.org_type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{o.area ?? <span className="text-neutral-400">Unknown</span>}</td>
                  <td className="px-3 py-2.5 text-xs">{o.phone || o.email ? <span>{o.phone ?? o.email}</span> : <span className="text-neutral-400">Unknown</span>}</td>
                  <td className="px-3 py-2.5">
                    <PotentialBadge potential={o.intelligence?.potential} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={confidenceTone(o.data_confidence)} title={o.source_label ?? undefined}>
                      {o.data_confidence}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {o.crm_status ? (
                      <Badge tone={statusTone(o.crm_status)}>{o.crm_status}</Badge>
                    ) : (
                      <button onClick={() => setCrmOrg(o)} className="text-xs text-[var(--accent)] hover:underline cursor-pointer">
                        Add to CRM
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-neutral-500 whitespace-nowrap">{formatDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <EmptyState title="No organizations match">Try clearing filters, add one manually, or import a file.</EmptyState>}
          <div className="flex items-center justify-between px-4 py-2.5 text-xs text-neutral-500 border-t border-neutral-200 dark:border-neutral-800">
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
