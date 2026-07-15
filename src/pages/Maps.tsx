import React, { useState, useEffect } from "react";
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { 
  Globe, 
  Layers, 
  MapPin, 
  Compass, 
  Sliders, 
  Info, 
  ChevronRight, 
  Activity, 
  ShieldAlert, 
  Droplets,
  CloudRain,
  Mountain
} from "lucide-react";
import { Location } from "../data/mockData.types";
import { generateLocationPolygon } from "../components/explorer/MapView";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string || "";
const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string || "";

interface MapsProps {
  locations: Location[];
  theme?: "light" | "dark";
}

// Declarative Polygon Component for Google Maps
function GooglePolygon({ paths, options }: { paths: { lat: number; lng: number }[]; options?: google.maps.PolygonOptions }) {
  const map = useMap();
  const serializedPaths = JSON.stringify(paths);
  const serializedOptions = JSON.stringify(options);

  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    const polygon = new google.maps.Polygon({ paths: JSON.parse(serializedPaths), ...options });
    polygon.setMap(map);
    return () => { polygon.setMap(null); };
  }, [map, serializedPaths, serializedOptions]);

  return null;
}

function GoogleMapsExplorer({ 
  locations, 
  selectedLocation, 
  setSelectedLocation,
}: { 
  locations: Location[]; 
  selectedLocation: Location | null; 
  setSelectedLocation: (loc: Location | null) => void;
}) {
  const [activeInfoWindowId, setActiveInfoWindowId] = useState<string | null>(null);

  const center = selectedLocation 
    ? { lat: selectedLocation.lat, lng: selectedLocation.lng }
    : { lat: 20.5937, lng: 78.9629 };

  return (
    <>
      {GOOGLE_MAPS_API_KEY ? (
      <APIProvider apiKey={GOOGLE_MAPS_API_KEY} version="weekly">
        <GoogleMap
        defaultCenter={center}
        center={selectedLocation ? { lat: selectedLocation.lat, lng: selectedLocation.lng } : undefined}
        defaultZoom={selectedLocation ? 16 : 5}
        zoom={selectedLocation ? 16 : undefined}
        mapId={GOOGLE_MAPS_MAP_ID}
        gestureHandling="greedy"
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
        mapTypeControl={true}
        fullscreenControl={true}
        scaleControl={true}
        streetViewControl={false}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
      >
        {locations.map((loc) => {
          const isSelected = selectedLocation?.id === loc.id;
          
          let pinColor = "#3b82f6";
          if (loc.rwhStatus === "Verified - Has RWH") pinColor = "#10b981";
          if (loc.rwhStatus === "Verified - No RWH") pinColor = "#ef4444";
          if (loc.rwhStatus === "Unknown") pinColor = "#f59e0b";

          let emoji = "📍";
          switch (loc.category) {
            case "School": emoji = "🏫"; break;
            case "College":
            case "University": emoji = "🎓"; break;
            case "Industry":
            case "Manufacturing": emoji = "🏭"; break;
            case "Hospital": emoji = "🏥"; break;
            case "Apartment/Residential": emoji = "🏢"; break;
          }

          const polygonPaths = generateLocationPolygon(loc);

          return (
            <React.Fragment key={loc.id}>
              <GooglePolygon
                paths={polygonPaths}
                options={{
                  strokeColor: isSelected ? "#EA580C" : pinColor,
                  strokeOpacity: 0.8,
                  strokeWeight: isSelected ? 3.5 : 1.5,
                  fillColor: isSelected ? "#EA580C" : pinColor,
                  fillOpacity: isSelected ? 0.38 : 0.12,
                }}
              />
              <AdvancedMarker
                position={{ lat: loc.lat, lng: loc.lng }}
                onClick={() => {
                  setSelectedLocation(loc);
                  setActiveInfoWindowId(loc.id);
                }}
              >
                <Pin 
                  background={pinColor} 
                  borderColor={isSelected ? "#ea580c" : "#ffffff"} 
                  glyph={emoji}
                />
              </AdvancedMarker>
            </React.Fragment>
          );
        })}

        {selectedLocation && activeInfoWindowId === selectedLocation.id && (
          <InfoWindow
            position={{ lat: selectedLocation.lat, lng: selectedLocation.lng }}
            onCloseClick={() => setActiveInfoWindowId(null)}
          >
            <div className="p-1 min-w-[180px] font-sans text-neutral-900">
              <h5 className="font-extrabold text-xs text-slate-900 m-0 leading-tight">{selectedLocation.name}</h5>
              <p className="text-[10px] text-slate-500 m-0 mb-1">{selectedLocation.district}, {selectedLocation.state}</p>
              <div className="text-[9px] bg-slate-50 p-1 rounded font-mono space-y-0.5 mt-1 border border-slate-100">
                <div>Area: {selectedLocation.landAreaAcres || 5} ac</div>
                <div>Status: {selectedLocation.rwhStatus}</div>
                <div>Stress: {selectedLocation.waterStressLevel}</div>
              </div>
            </div>
          </InfoWindow>
        )}
        </GoogleMap>
      </APIProvider>
      ) : (
        <div className="w-full h-full flex items-center justify-center text-sm text-slate-500 bg-white">
          Google Maps disabled — set VITE_GOOGLE_MAPS_API_KEY in your .env
        </div>
      )}
    </>
  );
}

export default function Maps({ locations, theme }: MapsProps) {
  const [activeLayer, setActiveLayer] = useState<"stress" | "aquifer" | "rainfall" | "density">("stress");
  const [selectedRegion, setSelectedRegion] = useState("all");
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);

  // Filter locations geographically for mapping
  const filteredLocations = selectedRegion === "all" 
    ? locations 
    : locations.filter(loc => loc.state.toLowerCase() === selectedRegion.toLowerCase());

  // Dynamic statistics based on the active map view
  const totalMeters = filteredLocations.reduce((acc, curr) => acc + (curr.landAreaAcres || 0), 0);
  const criticalStressCount = filteredLocations.filter(loc => loc.waterStressLevel === "Semi-Critical" || loc.waterStressLevel === "Over-Exploited").length;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="maps-intelligence-container">
      {/* Header and Controls */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-1.5 rounded text-indigo-600 dark:text-indigo-450">
              <Globe size={18} />
            </div>
            <h2 className="text-lg font-extrabold tracking-wider uppercase">Maps & Spatial Intelligence</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Advanced GIS layering, aquifer monitoring, and catchment boundaries overlay.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Filter Region:</span>
            <select 
              value={selectedRegion}
              onChange={(e) => {
                setSelectedRegion(e.target.value);
                setSelectedLocation(null);
              }}
              className="text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1.5 font-medium cursor-pointer"
            >
              <option value="all">All India Nodes (80)</option>
              <option value="Karnataka">Karnataka Region</option>
              <option value="Gujarat">Gujarat Region</option>
              <option value="Tamil Nadu">Tamil Nadu Region</option>
              <option value="Maharashtra">Maharashtra Region</option>
            </select>
          </div>
        </div>
      </div>

      {/* Geospatial Analytics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 p-3 rounded-md border border-amber-100/40 dark:border-amber-900/20">
            <ShieldAlert size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Critical Risk Blocks</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">{criticalStressCount} Hotspots</p>
            <p className="text-[9px] text-red-500 font-semibold mt-1">High stress aquifers detected</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 p-3 rounded-md border border-blue-100/40 dark:border-blue-900/20">
            <Droplets size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Total Surveyed Area</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">{totalMeters.toFixed(1)} Acres</p>
            <p className="text-[9px] text-slate-500 dark:text-zinc-400 mt-1">Property outline bounds matched</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40 dark:border-emerald-900/20">
            <Compass size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Active Coordinates</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">{filteredLocations.length} Mapped Nodes</p>
            <p className="text-[9px] text-emerald-600 font-semibold mt-1">Live GPS telemetry verified</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40 dark:border-indigo-900/20">
            <Layers size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Spatial Layers</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">4 Core Overlays</p>
            <p className="text-[9px] text-slate-500 dark:text-zinc-400 mt-1">Multispectral data linked</p>
          </div>
        </div>
      </div>

      {/* Main Map Split Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[500px]">
        {/* Layer Selection and Metadata (Left Panel) */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-4 lg:col-span-3 flex flex-col justify-between h-full overflow-y-auto">
          <div className="space-y-4">
            <h4 className="text-xs font-extrabold text-slate-500 dark:text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sliders size={13} className="text-indigo-600" />
              GIS Layer Controls
            </h4>

            <div className="space-y-1.5">
              <button 
                onClick={() => setActiveLayer("stress")}
                className={`w-full flex items-center justify-between p-2.5 rounded-md text-xs font-semibold border text-left transition-all ${
                  activeLayer === "stress"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/40 text-indigo-650 dark:text-indigo-400"
                    : "bg-transparent border-slate-150 dark:border-zinc-850 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-center gap-2">
                  <ShieldAlert size={14} />
                  <span>Water Stress Index</span>
                </div>
                <ChevronRight size={12} />
              </button>

              <button 
                onClick={() => setActiveLayer("aquifer")}
                className={`w-full flex items-center justify-between p-2.5 rounded-md text-xs font-semibold border text-left transition-all ${
                  activeLayer === "aquifer"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/40 text-indigo-650 dark:text-indigo-400"
                    : "bg-transparent border-slate-150 dark:border-zinc-850 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Mountain size={14} />
                  <span>Groundwater Aquifer Depth</span>
                </div>
                <ChevronRight size={12} />
              </button>

              <button 
                onClick={() => setActiveLayer("rainfall")}
                className={`w-full flex items-center justify-between p-2.5 rounded-md text-xs font-semibold border text-left transition-all ${
                  activeLayer === "rainfall"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/40 text-indigo-650 dark:text-indigo-400"
                    : "bg-transparent border-slate-150 dark:border-zinc-850 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-center gap-2">
                  <CloudRain size={14} />
                  <span>Rainfall Normal Dev Overlay</span>
                </div>
                <ChevronRight size={12} />
              </button>

              <button 
                onClick={() => setActiveLayer("density")}
                className={`w-full flex items-center justify-between p-2.5 rounded-md text-xs font-semibold border text-left transition-all ${
                  activeLayer === "density"
                    ? "bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-900/40 text-indigo-650 dark:text-indigo-400"
                    : "bg-transparent border-slate-150 dark:border-zinc-850 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-center gap-2">
                  <Layers size={14} />
                  <span>Industrial Consumption Density</span>
                </div>
                <ChevronRight size={12} />
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-zinc-850/80 pt-3 mt-3">
            <h5 className="text-[11px] font-bold text-slate-450 uppercase mb-1.5 flex items-center gap-1">
              <Info size={11} /> Layer Explanation
            </h5>
            <div className="p-2.5 bg-slate-50 dark:bg-zinc-900 rounded border border-slate-150 dark:border-zinc-800 text-[10.5px] leading-relaxed text-slate-500 dark:text-zinc-400">
              {activeLayer === "stress" && "CGWB Water Scarcity Index maps over-exploited and critical groundwater blocks. Highly useful for targeting corporate rainwater harvesting interventions."}
              {activeLayer === "aquifer" && "Deep geological core drill monitoring estimates safe water table draft bounds. Red zones suggest mandatory zero water consumption grids."}
              {activeLayer === "rainfall" && "Annual deviation contours mapping monsoon shortfalls. Used to calibrate volume calculations for dynamic rainwater capture designs."}
              {activeLayer === "density" && "Spatial clustering of thermal and heavy industry nodes. Indicates zones of critical runoff potential and high-volume local reuse capability."}
            </div>
          </div>
        </div>

        {/* Geospatial Map Container (Right Panel) */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm lg:col-span-9 h-full relative overflow-hidden flex flex-col">
          {/* Layer Active Indicator Tag */}
          <div className="absolute top-2.5 right-2.5 z-[1000] bg-slate-900/90 dark:bg-black/95 backdrop-blur-md px-3 py-1 rounded text-[10px] font-bold text-[#a8ffdb] shadow-md border border-slate-800/50 tracking-wider uppercase font-mono flex items-center gap-1.5">
            <Activity size={10} className="animate-pulse text-indigo-400" />
            Layer: {activeLayer} Overlay Active
          </div>

          <div className="flex-1 w-full h-full z-10">
            <GoogleMapsExplorer
              locations={filteredLocations}
              selectedLocation={selectedLocation}
              setSelectedLocation={setSelectedLocation}
            />
          </div>
        </div>
      </div>

      {/* Water Risk Node Ledger */}
      <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
          <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
            <MapPin size={16} className="text-indigo-600" />
            GIS Mapped Water Risk Coordinate Nodes
          </h4>
          <span className="text-xs font-mono text-slate-500">{filteredLocations.length} records available</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-850 text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="p-3">Facility Name</th>
                <th className="p-3">District & State</th>
                <th className="p-3">Latitude / Longitude</th>
                <th className="p-3 font-mono">Area (Acres)</th>
                <th className="p-3">Water Stress Class</th>
                <th className="p-3">Harvesting Audit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-850/80 text-slate-700 dark:text-zinc-300">
              {filteredLocations.slice(0, 5).map((loc) => (
                <tr 
                  key={loc.id} 
                  className={`hover:bg-slate-50/50 dark:hover:bg-zinc-900/40 cursor-pointer ${
                    selectedLocation?.id === loc.id ? "bg-indigo-50/20 dark:bg-indigo-950/10" : ""
                  }`}
                  onClick={() => setSelectedLocation(loc)}
                >
                  <td className="p-3 font-bold text-slate-900 dark:text-zinc-100">{loc.name}</td>
                  <td className="p-3 text-slate-500 dark:text-zinc-400">{loc.district}, {loc.state}</td>
                  <td className="p-3 font-mono text-[11px] text-indigo-650 dark:text-indigo-400">{loc.lat.toFixed(5)} , {loc.lng.toFixed(5)}</td>
                  <td className="p-3 font-mono">{loc.landAreaAcres || 2.5} ac</td>
                  <td className="p-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-extrabold border ${
                      loc.waterStressLevel === "Semi-Critical" || loc.waterStressLevel === "Over-Exploited"
                        ? "bg-red-50 dark:bg-red-950/25 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900/20"
                        : "bg-emerald-50 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/20"
                    }`}>
                      {loc.waterStressLevel || "Safe"}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-[11px] font-semibold">{loc.rwhStatus}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
