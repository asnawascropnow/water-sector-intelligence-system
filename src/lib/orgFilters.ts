import { useMemo, useState } from "react";
import type { OrgType } from "../../shared/constants";
import type { Organization } from "../../shared/types";

export interface OrgFilters {
  q: string;
  types: OrgType[]; // empty = all
  area: string;
  crm: "" | "in" | "out";
  potential: string;
}
export const EMPTY_FILTERS: OrgFilters = { q: "", types: [], area: "", crm: "", potential: "" };

export function useOrgFilters(orgs: Organization[] | null) {
  const [filters, setFilters] = useState<OrgFilters>(EMPTY_FILTERS);
  const filtered = useMemo(() => {
    if (!orgs) return [];
    const q = filters.q.trim().toLowerCase();
    return orgs.filter(
      (o) =>
        (!q || [o.name, o.area, o.address, o.sector, o.org_type].some((v) => v?.toLowerCase().includes(q))) &&
        (!filters.types.length || filters.types.includes(o.org_type)) &&
        (!filters.area || o.area === filters.area) &&
        (!filters.crm || (filters.crm === "in" ? o.opportunity_id : !o.opportunity_id)) &&
        (!filters.potential || (o.intelligence?.potential ?? "Unknown") === filters.potential),
    );
  }, [orgs, filters]);
  const areas = useMemo(() => [...new Set((orgs ?? []).map((o) => o.area).filter(Boolean) as string[])].sort(), [orgs]);
  const active = Boolean(filters.q || filters.types.length || filters.area || filters.crm || filters.potential);
  return { filters, setFilters, filtered, areas, active, reset: () => setFilters(EMPTY_FILTERS) };
}
