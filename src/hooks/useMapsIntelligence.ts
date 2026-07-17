import { useMemo, useCallback } from "react";
import { useMapsContext } from "../context/MapsContext";

/**
 * Custom hook to encapsulate map filters validation and helper services.
 */
export function useMapsIntelligence() {
  const context = useMapsContext();
  const { filters } = context;

  // Active filters counting helper
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filters.state) count++;
    if (filters.district) count++;
    if (filters.taluk) count++;
    if (filters.city) count++;
    if (filters.category) count++;
    if (filters.subCategory) count++;
    if (filters.organizationType) count++;
    if (filters.searchKeyword) count++;
    if (filters.ownership !== "All") count++;
    return count;
  }, [filters]);

  // Enforces selecting at least THREE filters (e.g. State + District + Category)
  const isFiltersValid = useMemo(() => {
    return activeFiltersCount >= 3;
  }, [activeFiltersCount]);

  // Clean filter list summary generator for user notices
  const getSelectedFiltersSummary = useCallback(() => {
    const list: string[] = [];
    if (filters.state) list.push(`State: ${filters.state}`);
    if (filters.district) list.push(`District: ${filters.district}`);
    if (filters.taluk) list.push(`Taluk: ${filters.taluk}`);
    if (filters.city) list.push(`City: ${filters.city}`);
    if (filters.category) list.push(`Category: ${filters.category}`);
    if (filters.organizationType) list.push(`Type: ${filters.organizationType}`);
    if (filters.searchKeyword) list.push(`Keyword: "${filters.searchKeyword}"`);
    return list;
  }, [filters]);

  return {
    ...context,
    activeFiltersCount,
    isFiltersValid,
    getSelectedFiltersSummary,
  };
}
