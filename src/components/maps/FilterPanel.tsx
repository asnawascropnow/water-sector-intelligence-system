import React from "react";
import { SlidersHorizontal, MapPin, Building2, Search, Trash2 } from "lucide-react";
import { useMapsIntelligence } from "../../hooks/useMapsIntelligence";

const STATES = [
  "Karnataka", "Maharashtra", "Tamil Nadu", "Gujarat", "Telangana", 
  "Delhi", "Rajasthan", "West Bengal", "Uttar Pradesh"
];

const DISTRICTS: Record<string, string[]> = {
  Karnataka: ["Bengaluru Urban", "Bengaluru Rural", "Mysuru", "Dharwad", "Mangaluru"],
  Maharashtra: ["Mumbai City", "Pune", "Nagpur", "Thane"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara"],
  Telangana: ["Hyderabad", "Rangareddy"],
  Delhi: ["New Delhi", "North Delhi", "South Delhi"],
  Rajasthan: ["Jaipur", "Jodhpur", "Udaipur"],
  "West Bengal": ["Kolkata", "Howrah"],
  "Uttar Pradesh": ["Lucknow", "Noida", "Kanpur"]
};

const TALUKS: Record<string, string[]> = {
  "Bengaluru Urban": ["Bengaluru East", "Bengaluru North", "Bengaluru South", "Bengaluru West", "Anekal"],
  "Bengaluru Rural": ["Devanahalli", "Nelamangala", "Doddaballapur", "Hosakote"],
  Pune: ["Pune City", "Haveli"],
  Chennai: ["Chennai North", "Chennai South"]
};

const CATEGORIES = [
  "School", "College", "University", "Hospital", "Apartment/Residential", 
  "Hotel", "Government Building", "Data Centre", "Mining", "Manufacturing", "Industry"
];

const ORG_TYPES = [
  "Industry", "Manufacturing", "Hospital", "School", "College", "University", 
  "Apartment", "Mall", "Commercial Building", "Software Park", "Data Centre", 
  "Mining", "Warehouse", "Airport", "Hotel", "Steel Industry", "Textile Industry", 
  "Food Industry", "Chemical Industry", "Pharmaceutical", "Automobile", 
  "Government Office", "Municipality", "Lake", "Reservoir", "Water Treatment Plant", 
  "Sewage Treatment Plant"
];

export default function FilterPanel() {
  const {
    filters,
    updateFilter,
    resetFilters,
    activeFiltersCount,
    isFiltersValid,
  } = useMapsIntelligence();

  const handleStateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    updateFilter("state", val);
    updateFilter("district", "");
    updateFilter("taluk", "");
  };

  const handleDistrictChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    updateFilter("district", val);
    updateFilter("taluk", "");
  };

  return (
    <div className="w-full h-full bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-4 flex flex-col justify-between overflow-y-auto font-sans text-slate-800 dark:text-zinc-200">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-zinc-850">
          <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-widest text-slate-400 dark:text-zinc-500">
            <SlidersHorizontal size={12} className="text-indigo-600" />
            <span>Map Filters</span>
          </div>
          {activeFiltersCount > 0 && (
            <button
              onClick={resetFilters}
              className="text-[10px] text-red-500 hover:text-red-650 flex items-center gap-1 font-bold bg-transparent border-0 cursor-pointer transition-all"
            >
              <Trash2 size={10} />
              Reset ({activeFiltersCount})
            </button>
          )}
        </div>

        {/* Validation Progress Meter */}
        <div className="p-3 rounded border border-dashed border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-950/20 text-xs">
          <div className="flex justify-between items-center mb-1.5 font-semibold text-[11px]">
            <span>Filter Requirement</span>
            <span className={isFiltersValid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-500"}>
              {activeFiltersCount} / 3 Selected
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 ${isFiltersValid ? 'bg-emerald-500' : 'bg-amber-400'}`}
              style={{ width: `${Math.min((activeFiltersCount / 3) * 100, 100)}%` }}
            />
          </div>
          {!isFiltersValid && (
            <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-2 m-0 leading-normal">
              Select at least <strong>three</strong> filters below to enable the <strong>Load Intelligence</strong> query.
            </p>
          )}
        </div>

        {/* Spatial Filters Group */}
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            <MapPin size={11} className="text-indigo-500" />
            <span>Spatial Boundary</span>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-450 uppercase mb-1">State</label>
              <select
                value={filters.state}
                onChange={handleStateChange}
                className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1.5 cursor-pointer font-medium outline-hidden focus:border-indigo-500 transition-colors"
              >
                <option value="">Select State</option>
                {STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-450 uppercase mb-1">District</label>
              <select
                value={filters.district}
                onChange={handleDistrictChange}
                disabled={!filters.state}
                className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1.5 cursor-pointer font-medium outline-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <option value="">Select District</option>
                {filters.state && DISTRICTS[filters.state]?.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-450 uppercase mb-1">Taluk</label>
              <select
                value={filters.taluk}
                onChange={(e) => updateFilter("taluk", e.target.value)}
                disabled={!filters.district}
                className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1.5 cursor-pointer font-medium outline-hidden disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <option value="">Select Taluk</option>
                {filters.district && TALUKS[filters.district]?.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-450 uppercase mb-1">City / Locality</label>
              <input
                type="text"
                value={filters.city}
                onChange={(e) => updateFilter("city", e.target.value)}
                placeholder="e.g. Whitefield, Jayanagar"
                className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1.5 outline-hidden font-medium focus:border-indigo-500 transition-colors"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-[10px] font-semibold text-slate-500 dark:text-zinc-450 uppercase">Scan Radius</label>
                <span className="text-[10px] font-mono font-bold text-indigo-600">{(filters.radius / 1000).toFixed(1)} km</span>
              </div>
              <input
                type="range"
                min="1000"
                max="15000"
                step="500"
                value={filters.radius}
                onChange={(e) => updateFilter("radius", parseInt(e.target.value))}
                className="w-full accent-indigo-600 cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Entity Filters Group */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-440 uppercase tracking-wider">
            <Building2 size={11} className="text-indigo-500" />
            <span>Entity Profiles</span>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-455 uppercase mb-1">Broad Category</label>
              <select
                value={filters.category}
                onChange={(e) => updateFilter("category", e.target.value)}
                className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1.5 cursor-pointer font-medium outline-hidden focus:border-indigo-500 transition-colors"
              >
                <option value="">Select Category</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-455 uppercase mb-1">Organization Type</label>
              <select
                value={filters.organizationType}
                onChange={(e) => updateFilter("organizationType", e.target.value)}
                className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1.5 cursor-pointer font-medium outline-hidden focus:border-indigo-500 transition-colors"
              >
                <option value="">Select Org Type</option>
                {ORG_TYPES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-455 uppercase mb-1">Ownership</label>
              <div className="grid grid-cols-2 gap-1.5">
                {(["All", "Government", "Private", "Public"] as const).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => updateFilter("ownership", o)}
                    className={`text-[10px] font-bold py-1.5 px-2 border rounded-sm transition-all cursor-pointer ${
                      filters.ownership === o
                        ? "bg-slate-900 dark:bg-zinc-100 text-white dark:text-slate-900 border-slate-900 dark:border-zinc-150"
                        : "bg-slate-50 dark:bg-zinc-950 border-slate-200 dark:border-zinc-850 hover:bg-slate-100 dark:hover:bg-zinc-900 text-slate-600 dark:text-zinc-400"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-zinc-455 uppercase mb-1">Search Keyword</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={12} />
                <input
                  type="text"
                  value={filters.searchKeyword}
                  onChange={(e) => updateFilter("searchKeyword", e.target.value)}
                  placeholder="e.g. IT Park, Steel, Quarry"
                  className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded pl-8 pr-2.5 py-1.5 outline-hidden font-medium focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t border-slate-100 dark:border-zinc-850 mt-4">
        <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-zinc-400 mb-2">
          <span>Active filter constraints:</span>
          <span className="font-mono font-bold text-slate-700 dark:text-zinc-350">{activeFiltersCount} active</span>
        </div>
      </div>
    </div>
  );
}
