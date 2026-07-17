import React, { useState } from "react";
import { Globe, Sliders, Info, ShieldAlert, Droplets, Compass, Layers, Activity } from "lucide-react";
import { Location, Assignment, TeamMember } from "../data/mockData.types";
import { MapsProvider, useMapsContext } from "../context/MapsContext";
import FilterPanel from "../components/maps/FilterPanel";
import GoogleMapsExplorer from "../components/maps/GoogleMapsExplorer";
import DetailDrawer from "../components/explorer/DetailDrawer";

interface MapsProps {
  locations: Location[];
  assignments: Assignment[];
  teamMembers: TeamMember[];
  onSyncLocations: (locs: Location[]) => void;
  onUpdateAssignment: (updated: Assignment) => void;
  theme?: "light" | "dark";
}

function MapsDashboardContent({ 
  assignments, 
  teamMembers, 
  onSyncLocations, 
  onUpdateAssignment 
}: Omit<MapsProps, "locations">) {
  const {
    discoveredPlaces,
    selectedLocation,
    setSelectedLocation,
    isIntelligenceLoaded,
  } = useMapsContext();

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeLayer, setActiveLayer] = useState<"stress" | "aquifer" | "rainfall" | "density">("stress");

  // Dynamic statistics reconstructed from the nested structure (estimatedRoofArea * 4 / 4046.86)
  const totalAcres = isIntelligenceLoaded 
    ? discoveredPlaces.reduce((acc, curr) => {
        const roofArea = curr.water.estimatedRoofArea || 0;
        return acc + (roofArea * 4 / 4046.86);
      }, 0)
    : 0;

  const criticalStressCount = isIntelligenceLoaded
    ? discoveredPlaces.filter(loc => loc.water.waterStressLevel === "Critical" || loc.water.waterStressLevel === "Over-Exploited").length
    : 0;

  const handleOpenDetails = (loc: Location) => {
    setIsDrawerOpen(true);
  };

  const handleUpdateLocationInDrawer = (updatedLoc: Location) => {
    setSelectedLocation(updatedLoc);
    onSyncLocations([updatedLoc]); // Synchronize drawer edits back
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="maps-intelligence-container">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-1.5 rounded text-indigo-600 dark:text-indigo-455">
              <Globe size={18} />
            </div>
            <h2 className="text-lg font-extrabold tracking-wider uppercase">Maps & Spatial Intelligence</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Live Google Places Discovery Engine & Aquifer Catchment Mapper.
          </p>
        </div>
      </div>

      {/* Geospatial Analytics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 p-3 rounded-md border border-amber-100/40 dark:border-amber-900/20">
            <ShieldAlert size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-450 uppercase tracking-wider">Critical Risk Hotspots</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">
              {isIntelligenceLoaded ? `${criticalStressCount} Sites` : "Locked"}
            </p>
            <p className="text-[9px] text-red-500 font-semibold mt-1">
              {isIntelligenceLoaded ? "High stress aquifers verified" : "Awaiting intelligence load"}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-blue-50 dark:bg-blue-950/30 text-blue-650 dark:text-blue-400 p-3 rounded-md border border-blue-100/40 dark:border-blue-900/20">
            <Droplets size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-450 uppercase tracking-wider">Total Surveyed Area</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">
              {isIntelligenceLoaded ? `${totalAcres.toFixed(1)} Acres` : "Locked"}
            </p>
            <p className="text-[9px] text-slate-500 dark:text-zinc-400 mt-1">
              {isIntelligenceLoaded ? "Viewport boundaries matched" : "Filters configuration required"}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40 dark:border-emerald-900/20">
            <Compass size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-450 uppercase tracking-wider">Discovered Nodes</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">
              {isIntelligenceLoaded ? `${discoveredPlaces.length} Mapped` : "Locked"}
            </p>
            <p className="text-[9px] text-emerald-600 font-semibold mt-1">
              {isIntelligenceLoaded ? "Synced with Digital Twin ledger" : "Google Places database lock"}
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-650 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40 dark:border-indigo-900/20">
            <Layers size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-450 uppercase tracking-wider">GIS Spatial Layer</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">
              {activeLayer.toUpperCase()}
            </p>
            <p className="text-[9px] text-slate-500 dark:text-zinc-400 mt-1">Overlay rendered successfully</p>
          </div>
        </div>
      </div>

      {/* Main Map Split Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[600px]">
        {/* Left Control Column (Filters + Explanation) */}
        <div className="lg:col-span-4 xl:col-span-3 flex flex-col gap-4 h-full min-h-0">
          <div className="flex-1 min-h-0">
            <FilterPanel />
          </div>
          
          <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-4 shadow-sm shrink-0">
            <h5 className="text-[11px] font-bold text-slate-450 dark:text-zinc-500 mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <Info size={11} className="text-indigo-500" /> GIS Layer Controls
            </h5>
            <div className="grid grid-cols-2 gap-1.5 text-[10px] font-semibold">
              {(["stress", "aquifer", "rainfall", "density"] as const).map((layer) => (
                <button
                  key={layer}
                  onClick={() => setActiveLayer(layer)}
                  className={`py-1.5 px-2 border rounded-sm transition-all cursor-pointer capitalize ${
                    activeLayer === layer
                      ? "bg-indigo-50 dark:bg-indigo-950/20 text-indigo-650 dark:text-indigo-400 border-indigo-200 dark:border-indigo-900/40"
                      : "bg-slate-50 dark:bg-zinc-950 border-slate-200 dark:border-zinc-850 text-slate-600 dark:text-zinc-400"
                  }`}
                >
                  {layer}
                </button>
              ))}
            </div>
            <div className="mt-3 p-2.5 bg-slate-50 dark:bg-zinc-900 rounded border border-slate-150 dark:border-zinc-800 text-[10px] leading-relaxed text-slate-500 dark:text-zinc-400">
              {activeLayer === "stress" && "CGWB Scarcity Index maps critical groundwater exploitation grids."}
              {activeLayer === "aquifer" && "Deep geological monitoring estimates safe aquifer recharge volumes."}
              {activeLayer === "rainfall" && "Annual dev contours calibrate capture parameters for system designs."}
              {activeLayer === "density" && "Clustering of heavy industry consumption indicating local recycling potentials."}
            </div>
          </div>
        </div>

        {/* Right Map Panel */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm lg:col-span-8 xl:col-span-9 h-full relative overflow-hidden flex flex-col">
          {/* Active Layer Tag */}
          <div className="absolute top-2.5 right-2.5 z-[500] bg-slate-900/90 dark:bg-black/95 backdrop-blur-md px-3 py-1.5 rounded text-[10px] font-bold text-[#a8ffdb] shadow-md border border-slate-800/50 tracking-wider uppercase font-mono flex items-center gap-1.5">
            <Activity size={10} className="animate-pulse text-indigo-400" />
            <span>Layer: {activeLayer} overlay active</span>
          </div>

          <div className="flex-1 w-full h-full">
            <GoogleMapsExplorer 
              onSyncLocations={onSyncLocations} 
              onOpenDetails={handleOpenDetails} 
            />
          </div>
        </div>
      </div>

      {/* Sliding Details Drawer Panel */}
      {selectedLocation && (
        <DetailDrawer
          location={selectedLocation}
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          onUpdateLocation={handleUpdateLocationInDrawer}
          assignments={assignments}
          teamMembers={teamMembers}
          onUpdateAssignment={onUpdateAssignment}
          initialTab="profile"
        />
      )}
    </div>
  );
}

export default function Maps(props: MapsProps) {
  return (
    <MapsProvider>
      <MapsDashboardContent 
        assignments={props.assignments}
        teamMembers={props.teamMembers}
        onSyncLocations={props.onSyncLocations}
        onUpdateAssignment={props.onUpdateAssignment}
      />
    </MapsProvider>
  );
}
