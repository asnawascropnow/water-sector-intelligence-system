import React, { useState, useMemo } from "react";
import { SlidersHorizontal, List, Columns, Map, ChevronRight, ChevronLeft } from "lucide-react";
import { Location, Category, RwhStatus, WaterStressLevel, Assignment, TeamMember } from "../data/mockData.types";
import FilterPanel from "../components/explorer/FilterPanel";
import LocationList from "../components/explorer/LocationList";
import MapView from "../components/explorer/MapView";
import DetailDrawer from "../components/explorer/DetailDrawer";

interface ExplorerProps {
  locations: Location[];
  assignments: Assignment[];
  teamMembers: TeamMember[];
  onUpdateLocation: (updated: Location) => void;
  onUpdateAssignment: (updated: Assignment) => void;
  searchQuery: string;
  selectedCategories: Category[];
  setSelectedCategories: (cats: Category[]) => void;
}

export default function Explorer({
  locations,
  assignments,
  teamMembers,
  onUpdateLocation,
  onUpdateAssignment,
  searchQuery,
  selectedCategories,
  setSelectedCategories,
}: ExplorerProps) {
  // --- WORKSPACE VIEW MODE ---
  // "split" = List + Map side-by-side (default)
  // "list" = Directory list full-width
  // "map" = GIS map full-width
  const [viewMode, setViewMode] = useState<"split" | "list" | "map">("split");
  
  // --- INDEPENDENT COLLAPSIBLE STATES ---
  const [isFilterCollapsed, setIsFilterCollapsed] = useState(false);
  const [isListCollapsed, setIsListCollapsed] = useState(false);

  // --- FILTERS STATE ---
  const [selectedState, setSelectedState] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [selectedRwhStatuses, setSelectedRwhStatuses] = useState<RwhStatus[]>([]);
  const [selectedWaterStressLevels, setSelectedWaterStressLevels] = useState<WaterStressLevel[]>([]);
  const [minArea, setMinArea] = useState(0);
  const [maxArea, setMaxArea] = useState(5000);

  // --- CRM FILTERS STATE ---
  const [selectedAssignee, setSelectedAssignee] = useState("All");
  const [selectedPriority, setSelectedPriority] = useState("All");
  const [selectedWorkStatus, setSelectedWorkStatus] = useState("All");

  // --- SELECTION STATE ---
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // --- FILTER RESET ---
  const handleResetFilters = () => {
    setSelectedState("");
    setSelectedDistrict("");
    setSelectedCategories([]);
    setSelectedRwhStatuses([]);
    setSelectedWaterStressLevels([]);
    setMinArea(0);
    setMaxArea(5000);
    
    // Reset CRM
    setSelectedAssignee("All");
    setSelectedPriority("All");
    setSelectedWorkStatus("All");
  };

  // --- FILTER LOGIC ENGINE ---
  const filteredLocations = useMemo(() => {
    return locations.filter((loc) => {
      // 1. Cascading Geography Filter
      if (selectedState && loc.state !== selectedState) return false;
      if (selectedDistrict && loc.district !== selectedDistrict) return false;

      // 2. Multi-select Categories
      if (selectedCategories.length > 0 && !selectedCategories.includes(loc.category)) {
        return false;
      }

      // 3. Multi-select RWH Status
      if (selectedRwhStatuses.length > 0 && !selectedRwhStatuses.includes(loc.water.rainwaterHarvesting.status)) {
        return false;
      }

      // 4. Multi-select Water Stress
      if (
        selectedWaterStressLevels.length > 0 &&
        !selectedWaterStressLevels.includes(loc.water.waterStressLevel)
      ) {
        return false;
      }

      // 5. Land Area Range (calculated back from estimatedRoofArea)
      const acres = loc.water.estimatedRoofArea ? (loc.water.estimatedRoofArea * 4 / 4046.86) : 0;
      if (acres < minArea || acres > maxArea) {
        return false;
      }

      // 6. CRM Assignment Filters
      const assign = assignments.find((a) => a.locationId === loc.id);

      // 6a. Assigned To Filter
      if (selectedAssignee !== "All") {
        if (selectedAssignee === "Unassigned") {
          if (assign) return false;
        } else {
          if (!assign || assign.assignedToId !== selectedAssignee) return false;
        }
      }

      // 6b. Work Status Filter
      if (selectedWorkStatus !== "All") {
        if (selectedWorkStatus === "Unassigned") {
          if (assign) return false;
        } else {
          if (!assign || assign.currentStatus !== selectedWorkStatus) return false;
        }
      }

      // 6c. Priority Filter
      if (selectedPriority !== "All") {
        if (!assign || assign.priority !== selectedPriority) return false;
      }

      // 7. Global Search Query Integration
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = loc.name.toLowerCase().includes(query);
        const matchesDistrict = loc.district.toLowerCase().includes(query);
        const matchesPincode = loc.postalCode.includes(query);
        const matchesState = loc.state.toLowerCase().includes(query);

        if (
          !matchesName &&
          !matchesDistrict &&
          !matchesPincode &&
          !matchesState
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    locations,
    assignments,
    selectedState,
    selectedDistrict,
    selectedCategories,
    selectedRwhStatuses,
    selectedWaterStressLevels,
    minArea,
    maxArea,
    selectedAssignee,
    selectedPriority,
    selectedWorkStatus,
    searchQuery,
  ]);

  // Synchronized callback for selecting a location from list/map
  const handleLocationSelect = (loc: Location | null) => {
    setSelectedLocation(loc);
    if (loc) {
      setIsDrawerOpen(true);
      setIsFilterCollapsed(true);
      setIsListCollapsed(true);
    } else {
      setIsDrawerOpen(false);
    }
  };

  return (
    <div className="h-[calc(100vh-140px)] md:h-[calc(100vh-110px)] flex flex-col gap-4" id="explorer-screen-wrapper">
      
      {/* Dynamic Sub-header & Mode Controller */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-neutral-200/60 dark:border-neutral-800/60 pb-3 flex-shrink-0">
        <div>
          <h2 className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-widest">
            Water Intelligence Directory
          </h2>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">
            Active Nodes: <span className="font-bold text-neutral-900 dark:text-white">{filteredLocations.length} Mapped</span>
          </p>
        </div>

        {/* Dynamic Toolbar */}
        <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
          {/* Toggle Filter Panel */}
          <button
            onClick={() => setIsFilterCollapsed(!isFilterCollapsed)}
            className={`h-8 px-2.5 rounded-sm text-[11px] font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
              !isFilterCollapsed 
                ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-black border-neutral-900 dark:border-neutral-100" 
                : "bg-white dark:bg-[#0a0a0a] text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
            }`}
            title="Toggle Refine Explorer"
          >
            <SlidersHorizontal size={11} />
            <span>Refine Panel: {!isFilterCollapsed ? "Open" : "Collapsed"}</span>
          </button>

          {/* Toggle Organization List */}
          {(viewMode === "split" || viewMode === "list") && (
            <button
              onClick={() => setIsListCollapsed(!isListCollapsed)}
              className={`h-8 px-2.5 rounded-sm text-[11px] font-medium border flex items-center gap-1.5 transition-colors cursor-pointer ${
                !isListCollapsed 
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-black border-neutral-900 dark:border-neutral-100" 
                  : "bg-white dark:bg-[#0a0a0a] text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
              }`}
              title="Toggle Organization List"
            >
              <List size={11} />
              <span>Org List: {!isListCollapsed ? "Open" : "Collapsed"}</span>
            </button>
          )}

          {/* Segmented View Mode Toggle */}
          <div className="bg-neutral-100 dark:bg-neutral-900/60 p-0.5 rounded-sm border border-neutral-200/80 dark:border-neutral-800/80 flex items-center text-[11px] font-medium">
            <button
              onClick={() => {
                setViewMode("list");
                setIsListCollapsed(false);
              }}
              className={`px-3 py-1 rounded-sm flex items-center gap-1.5 transition-colors cursor-pointer ${
                viewMode === "list" 
                  ? "bg-white dark:bg-[#0a0a0a] text-neutral-950 dark:text-white shadow-xs font-semibold" 
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
              }`}
              title="Directory List View"
            >
              <List size={11} />
              <span className="hidden xs:inline">Directory</span>
            </button>
            <button
              onClick={() => {
                setViewMode("split");
                setIsListCollapsed(false);
              }}
              className={`px-3 py-1 rounded-sm flex items-center gap-1.5 transition-colors cursor-pointer ${
                viewMode === "split" 
                  ? "bg-white dark:bg-[#0a0a0a] text-neutral-950 dark:text-white shadow-xs font-semibold" 
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
              }`}
              title="Split Directory & Map"
            >
              <Columns size={11} />
              <span className="hidden xs:inline">Split Screen</span>
            </button>
            <button
              onClick={() => setViewMode("map")}
              className={`px-3 py-1 rounded-sm flex items-center gap-1.5 transition-colors cursor-pointer ${
                viewMode === "map" 
                  ? "bg-white dark:bg-[#0a0a0a] text-neutral-950 dark:text-white shadow-xs font-semibold" 
                  : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-300"
              }`}
              title="Interactive GIS Map View"
            >
              <Map size={11} />
              <span className="hidden xs:inline">GIS Map</span>
            </button>
          </div>
        </div>
      </div>

      {/* Workspace Area */}
      <div className="flex-1 flex gap-4 overflow-hidden min-h-0 relative">
        
        {/* 1. COLLAPSIBLE FILTER PANEL */}
        {isFilterCollapsed ? (
          <div 
            onClick={() => setIsFilterCollapsed(false)}
            className="w-[36px] h-full flex-shrink-0 bg-white dark:bg-[#0a0a0a] border border-neutral-200/80 dark:border-neutral-800/80 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 rounded-sm cursor-pointer flex flex-col items-center py-4 justify-between group transition-all"
            title="Expand Filters Panel"
          >
            <div className="flex flex-col items-center gap-4">
              <SlidersHorizontal size={12} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors" />
              <span className="text-[9px] font-bold tracking-wider uppercase text-neutral-450 group-hover:text-neutral-900 dark:group-hover:text-white whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                Refine Explorer
              </span>
            </div>
            <ChevronRight size={13} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-all transform group-hover:translate-x-0.5" />
          </div>
        ) : (
          <div className="w-[240px] xl:w-[270px] h-full flex-shrink-0 flex flex-col relative">
            <FilterPanel
              locations={locations}
              teamMembers={teamMembers}
              selectedState={selectedState}
              setSelectedState={setSelectedState}
              selectedDistrict={selectedDistrict}
              setSelectedDistrict={setSelectedDistrict}
              selectedCategories={selectedCategories}
              setSelectedCategories={setSelectedCategories}
              selectedRwhStatuses={selectedRwhStatuses}
              setSelectedRwhStatuses={setSelectedRwhStatuses}
              selectedWaterStressLevels={selectedWaterStressLevels}
              setSelectedWaterStressLevels={setSelectedWaterStressLevels}
              minArea={minArea}
              setMinArea={setMinArea}
              maxArea={maxArea}
              setMaxArea={setMaxArea}
              
              selectedAssignee={selectedAssignee}
              setSelectedAssignee={setSelectedAssignee}
              selectedPriority={selectedPriority}
              setSelectedPriority={setSelectedPriority}
              selectedWorkStatus={selectedWorkStatus}
              setSelectedWorkStatus={setSelectedWorkStatus}

              onReset={handleResetFilters}
            />
            <button
              onClick={() => setIsFilterCollapsed(true)}
              className="absolute -right-3 top-1/2 -translate-y-1/2 w-3.5 h-16 bg-white dark:bg-[#0a0a0a] border-y border-r border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 rounded-r-sm flex items-center justify-center cursor-pointer shadow-xs z-20 group"
              title="Collapse Filters Panel"
            >
              <ChevronLeft size={10} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white" />
            </button>
          </div>
        )}

        {/* 2. COLLAPSIBLE DIRECTORY LIST */}
        {(viewMode === "list" || viewMode === "split") && (
          isListCollapsed ? (
            <div 
              onClick={() => setIsListCollapsed(false)}
              className="w-[36px] h-full flex-shrink-0 bg-white dark:bg-[#0a0a0a] border border-neutral-200/80 dark:border-neutral-800/80 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 rounded-sm cursor-pointer flex flex-col items-center py-4 justify-between group transition-all"
              title="Expand Organization List"
            >
              <div className="flex flex-col items-center gap-4">
                <List size={12} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors" />
                <span className="text-[9px] font-bold tracking-wider uppercase text-neutral-450 group-hover:text-neutral-900 dark:group-hover:text-white whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                  Organization List
                </span>
              </div>
              <ChevronRight size={13} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-all transform group-hover:translate-x-0.5" />
            </div>
          ) : (
            <div className={`h-full flex flex-col flex-shrink-0 relative ${
              viewMode === "list" 
                ? "flex-1" 
                : "w-[330px] xl:w-[380px]"
            }`}>
              <LocationList
                locations={filteredLocations}
                selectedLocationId={selectedLocation?.id || null}
                onLocationSelect={handleLocationSelect}
              />
              {viewMode === "split" && (
                <button
                  onClick={() => setIsListCollapsed(true)}
                  className="absolute -right-3 top-1/2 -translate-y-1/2 w-3.5 h-16 bg-white dark:bg-[#0a0a0a] border-y border-r border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-900 rounded-r-sm flex items-center justify-center cursor-pointer shadow-xs z-20 group"
                  title="Collapse Organization List"
                >
                  <ChevronLeft size={10} className="text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white" />
                </button>
              )}
            </div>
          )
        )}

        {/* 3. GIS MAP PANE */}
        {(viewMode === "map" || viewMode === "split") && (
          <div className="flex-1 h-full bg-white dark:bg-[#0a0a0a] border border-neutral-200/80 dark:border-neutral-800/80 rounded-[8px] overflow-hidden relative">
            <MapView
              locations={filteredLocations}
              selectedLocation={selectedLocation}
              onLocationSelect={handleLocationSelect}
              onOpenDrawer={() => setIsDrawerOpen(true)}
            />

            {(isFilterCollapsed || isListCollapsed) && (
              <div className="absolute top-4 left-4 z-[500] flex flex-col gap-2 pointer-events-auto">
                {isFilterCollapsed && (
                  <button
                    onClick={() => setIsFilterCollapsed(false)}
                    className="bg-white/95 dark:bg-[#0a0a0a]/95 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900 px-3 py-1.5 rounded-sm border border-neutral-200 dark:border-neutral-800 shadow-md flex items-center gap-1.5 text-[10px] font-semibold cursor-pointer transition-all"
                  >
                    <SlidersHorizontal size={10} className="text-indigo-600 dark:text-indigo-400" />
                    <span>Expand Filters</span>
                  </button>
                )}
                {isListCollapsed && (viewMode === "split" || viewMode === "list") && (
                  <button
                    onClick={() => setIsListCollapsed(false)}
                    className="bg-white/95 dark:bg-[#0a0a0a]/95 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900 px-3 py-1.5 rounded-sm border border-neutral-200 dark:border-neutral-800 shadow-md flex items-center gap-1.5 text-[10px] font-semibold cursor-pointer transition-all"
                  >
                    <List size={10} className="text-indigo-600 dark:text-indigo-400" />
                    <span>Expand Org List</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Sliding Details Drawer Panel */}
      <DetailDrawer
        location={selectedLocation}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateLocation={(updatedLoc) => {
          setSelectedLocation(updatedLoc);
          onUpdateLocation(updatedLoc);
        }}
        assignments={assignments}
        teamMembers={teamMembers}
        onUpdateAssignment={onUpdateAssignment}
        initialTab="profile"
      />
    </div>
  );
}
