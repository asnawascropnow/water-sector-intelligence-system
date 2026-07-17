import React, { useState, useMemo } from "react";
import { ArrowUpDown, SlidersHorizontal, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { Location } from "../../data/mockData.types";
import LocationRow from "./LocationRow";

interface LocationListProps {
  locations: Location[];
  selectedLocationId: string | null;
  onLocationSelect: (location: Location) => void;
}

type SortField = "name" | "landArea" | "verifiedDate";

export default function LocationList({
  locations,
  selectedLocationId,
  onLocationSelect,
}: LocationListProps) {
  const [sortBy, setSortBy] = useState<SortField>("name");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // 1. Sort the dynamic locations
  const sortedLocations = useMemo(() => {
    return [...locations].sort((a, b) => {
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      } else if (sortBy === "landArea") {
        const aAcres = a.water.estimatedRoofArea ? (a.water.estimatedRoofArea * 4 / 4046.86) : 0;
        const bAcres = b.water.estimatedRoofArea ? (b.water.estimatedRoofArea * 4 / 4046.86) : 0;
        return bAcres - aAcres; // descending
      } else if (sortBy === "verifiedDate") {
        return b.geometry.lastUpdated.localeCompare(a.geometry.lastUpdated); // descending
      }
      return 0;
    });
  }, [locations, sortBy]);

  // 2. Paginate the sorted locations
  const paginatedLocations = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return sortedLocations.slice(startIndex, startIndex + itemsPerPage);
  }, [sortedLocations, currentPage]);

  const totalPages = Math.ceil(sortedLocations.length / itemsPerPage) || 1;

  // Reset page if filtering changes total count
  useMemo(() => {
    setCurrentPage(1);
  }, [locations.length]);

  const startIndex = (currentPage - 1) * itemsPerPage + 1;
  const endIndex = Math.min(currentPage * itemsPerPage, sortedLocations.length);

  return (
    <div
      id="location-list-pane"
      className="bg-white border border-slate-200 rounded-md flex flex-col h-full shadow-sm"
    >
      {/* Search/Sort Bar */}
      <div className="p-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <ArrowUpDown size={14} className="text-indigo-600" />
          <span>Sort By</span>
        </div>

        <div className="flex gap-1">
          <button
            onClick={() => setSortBy("name")}
            className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-all cursor-pointer ${
              sortBy === "name"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            Name (A-Z)
          </button>
          <button
            onClick={() => setSortBy("landArea")}
            className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-all cursor-pointer ${
              sortBy === "landArea"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            Area (High-Low)
          </button>
          <button
            onClick={() => setSortBy("verifiedDate")}
            className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-all cursor-pointer ${
              sortBy === "verifiedDate"
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
          >
            Last Verified
          </button>
        </div>
      </div>

      {/* Row Count Info */}
      <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
        <span>
          Showing <span className="font-semibold text-slate-800">{sortedLocations.length ? startIndex : 0}-{endIndex}</span> of{" "}
          <span className="font-semibold text-slate-800">{sortedLocations.length}</span> entries
        </span>
        {locations.length === 0 && (
          <span className="text-rose-600 font-medium">No matches found</span>
        )}
      </div>

      {/* Scrollable Listings Area */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100" id="location-listings-scroller">
        {sortedLocations.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 text-center text-slate-400 h-full">
            <Info size={32} className="text-slate-200 mb-2" />
            <p className="text-xs font-semibold text-slate-700">No Institutions Match Filters</p>
            <p className="text-[11px] mt-1 text-slate-500">
              Try resetting geographical options or extending the area scale.
            </p>
          </div>
        ) : (
          paginatedLocations.map((loc) => (
            <LocationRow
              key={loc.id}
              location={loc}
              isSelected={selectedLocationId === loc.id}
              onClick={() => onLocationSelect(loc)}
            />
          ))
        )}
      </div>

      {/* Pagination Controls */}
      {sortedLocations.length > 0 && (
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Page <span className="font-semibold">{currentPage}</span> of {totalPages}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              id="pagination-prev-btn"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all cursor-pointer"
              title="Previous Page"
            >
              <ChevronLeft size={16} />
            </button>
            
            <button
              id="pagination-next-btn"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 transition-all cursor-pointer"
              title="Next Page"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
