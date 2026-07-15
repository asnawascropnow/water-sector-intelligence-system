import React, { useEffect, useState, useMemo } from "react";
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { Location } from "../../data/mockData.types";
import { Info } from "lucide-react";

interface MapViewProps {
  locations: Location[];
  selectedLocation: Location | null;
  onLocationSelect: (location: Location) => void;
  onOpenDrawer: () => void;
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string || "";
const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string || "";

// Helper to generate a stable seed from a string
function getSeed(str: string) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

// Generates a beautiful, stable multi-vertex closed polygon based on location acreage & coords
export function generateLocationPolygon(loc: Location): { lat: number; lng: number }[] {
  const centerLat = loc.lat;
  const centerLng = loc.lng;
  const acres = loc.landAreaAcres || 5; // default to 5 acres if missing
  const areaSqm = acres * 4046.86;
  const radiusMeters = Math.sqrt(areaSqm / Math.PI);
  
  const latOffsetFactor = radiusMeters / 111320;
  const lngOffsetFactor = radiusMeters / (111320 * Math.cos(centerLat * Math.PI / 180));
  
  const seed = getSeed(loc.id + loc.name);
  const numPoints = 6 + (seed % 3); // 6 to 8 vertexes to make it look organic
  const points: { lat: number; lng: number }[] = [];
  
  for (let i = 0; i < numPoints; i++) {
    const angle = (i * 2 * Math.PI) / numPoints;
    // Add stable distortion per angle to resemble a realistic survey plot
    const variationSeed = Math.sin(seed + i * 15) * 0.22 + 0.95; // stable 0.73 - 1.17 multiplier
    const rLat = latOffsetFactor * variationSeed;
    const rLng = lngOffsetFactor * variationSeed;
    
    const ptLat = centerLat + rLat * Math.cos(angle);
    const ptLng = centerLng + rLng * Math.sin(angle);
    points.push({ lat: ptLat, lng: ptLng });
  }
  
  return points;
}

// Declarative Polygon Component for Google Maps
function GooglePolygon({ paths, options }: { paths: { lat: number; lng: number }[]; options?: google.maps.PolygonOptions }) {
  const map = useMap();
  const serializedPaths = JSON.stringify(paths);
  const serializedOptions = JSON.stringify(options);

  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    const polygon = new google.maps.Polygon({
      paths: JSON.parse(serializedPaths),
      ...options,
    });

    polygon.setMap(map);

    return () => {
      polygon.setMap(null);
    };
  }, [map, serializedPaths, serializedOptions]);

  return null;
}

export default function MapView({
  locations,
  selectedLocation,
  onLocationSelect,
  onOpenDrawer,
}: MapViewProps) {
  // Default map center set to South-Central India (Karnataka/Bengaluru focus)
  const defaultCenter = { lat: 12.9716, lng: 77.5946 };
  const defaultZoom = 11;

  // Track map category toggles for openly available datasets
  const [visibleCategories, setVisibleCategories] = useState<Record<string, boolean>>({
    School: true,
    College: true,
    University: true,
    Industry: true,
    Manufacturing: true,
    Hospital: true,
    "Apartment/Residential": true,
    Other: true,
  });

  const [activeInfoWindowId, setActiveInfoWindowId] = useState<string | null>(null);

  // Sync active info window with list selection
  useEffect(() => {
    if (selectedLocation) {
      setActiveInfoWindowId(selectedLocation.id);
    }
  }, [selectedLocation]);

  // Filter locations displayed on the map based on visible categories
  const filteredMapLocations = useMemo(() => {
    return locations.filter((loc) => visibleCategories[loc.category] !== false);
  }, [locations, visibleCategories]);

  // Status badges inside map popup
  const getRwhStatusColor = (status: string) => {
    switch (status) {
      case "Verified - Has RWH":
        return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/45 dark:text-emerald-300 dark:border-emerald-800";
      case "Verified - No RWH":
        return "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/45 dark:text-red-300 dark:border-red-800";
      default:
        return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/45 dark:text-amber-300 dark:border-amber-800";
    }
  };

  const toggleCategory = (cat: string) => {
    setVisibleCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  return (
    <div className="w-full h-full relative" id="google-map-wrapper">
      {GOOGLE_MAPS_API_KEY ? (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} version="weekly">
          <GoogleMap
          defaultCenter={defaultCenter}
          center={selectedLocation ? { lat: selectedLocation.lat, lng: selectedLocation.lng } : undefined}
          defaultZoom={defaultZoom}
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
          {filteredMapLocations.map((loc) => {
            const isSelected = selectedLocation?.id === loc.id;

            // Determine pin color based on RWH status
            let pinColor = "#3b82f6"; // blue
            if (loc.rwhStatus === "Verified - Has RWH") pinColor = "#10b981"; // green
            if (loc.rwhStatus === "Verified - No RWH") pinColor = "#ef4444"; // red
            if (loc.rwhStatus === "Unknown") pinColor = "#f59e0b"; // yellow/orange

            // Mapping category to emoji glyph
            let emoji = "📍";
            switch (loc.category) {
              case "School":
                emoji = "🏫";
                break;
              case "College":
              case "University":
                emoji = "🎓";
                break;
              case "Industry":
              case "Manufacturing":
                emoji = "🏭";
                break;
              case "Hospital":
                emoji = "🏥";
                break;
              case "Apartment/Residential":
                emoji = "🏢";
                break;
            }

            // Generate paths for property boundary
            const polygonPaths = generateLocationPolygon(loc);

            return (
              <React.Fragment key={loc.id}>
                {/* Boundary Polygon */}
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

                {/* Advanced Marker */}
                <AdvancedMarker
                  position={{ lat: loc.lat, lng: loc.lng }}
                  onClick={() => {
                    onLocationSelect(loc);
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
              <div className="p-1 min-w-[210px] text-slate-800 font-sans">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-xs" title={selectedLocation.category}>
                    {selectedLocation.category === "School" && "🏫"}
                    {(selectedLocation.category === "College" || selectedLocation.category === "University") && "🎓"}
                    {(selectedLocation.category === "Industry" || selectedLocation.category === "Manufacturing") && "🏭"}
                    {selectedLocation.category === "Hospital" && "🏥"}
                    {selectedLocation.category === "Apartment/Residential" && "🏢"}
                    {selectedLocation.category === "Other" && "📍"}
                  </span>
                  <h6 className="font-bold text-[13px] leading-tight m-0 truncate flex-1 text-slate-900">
                    {selectedLocation.name}
                  </h6>
                </div>
                <p className="text-[11px] text-slate-500 m-0 mb-2 truncate">
                  {selectedLocation.district}, {selectedLocation.state} (Pincode: {selectedLocation.pincode})
                </p>

                <div className="text-[10px] space-y-0.5 mb-2.5 bg-slate-50 p-1.5 rounded border border-slate-100 font-mono">
                  <div><span className="text-slate-400">Dataset:</span> {selectedLocation.dataSource || "Open Data"}</div>
                  <div><span className="text-slate-400">Source:</span> {selectedLocation.waterSource}</div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span
                    className={`text-[9px] font-extrabold px-1.5 py-0.5 border rounded-sm tracking-wide ${getRwhStatusColor(
                      selectedLocation.rwhStatus
                    )}`}
                  >
                    {selectedLocation.rwhStatus === "Verified - Has RWH"
                      ? "HAS RWH"
                      : selectedLocation.rwhStatus === "Verified - No RWH"
                      ? "NO RWH"
                      : "UNKNOWN"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenDrawer();
                    }}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold px-2 py-1 rounded transition-all cursor-pointer shadow-sm border-0"
                  >
                    View Details
                  </button>
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

      {/* Floating Map Legend (Bottom-Left) */}
      <div className="absolute bottom-5 left-5 z-[500] bg-white/95 dark:bg-[#09090b]/95 border border-slate-200 dark:border-zinc-800 rounded-md p-3 shadow-md text-xs space-y-1.5 text-slate-800 dark:text-zinc-200 max-w-[200px] backdrop-blur-md">
        <div className="font-bold text-[11px] text-slate-500 dark:text-zinc-400 uppercase tracking-wider pb-1 border-b border-slate-100 dark:border-zinc-850">
          RWH Status Indicator
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500 flex items-center justify-center">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
          </span>
          <span className="text-[11px]">Verified - Has RWH</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-red-50 dark:bg-red-950/40 border border-red-500 flex items-center justify-center">
            <span className="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
          </span>
          <span className="text-[11px]">Verified - No RWH</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-500 flex items-center justify-center">
            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full"></span>
          </span>
          <span className="text-[11px]">Status Unknown</span>
        </div>
      </div>

      {/* Interactive Public Datasets Overlay Panel (Top-Right) */}
      <div className="absolute top-4 right-4 z-[500] bg-white/95 dark:bg-[#09090b]/95 border border-slate-200 dark:border-zinc-800 rounded-md p-3.5 shadow-md text-xs w-[240px] backdrop-blur-md">
        <div className="font-bold text-[11px] text-slate-500 dark:text-zinc-400 uppercase tracking-wider pb-1.5 border-b border-slate-100 dark:border-zinc-850 flex items-center justify-between">
          <span>India Open Datasets</span>
          <span className="bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold text-[9px] px-1.5 py-0.2 rounded font-mono">LIVE</span>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-zinc-500 leading-normal my-1.5">
          Select and filter open public agency records mapped across the region:
        </p>
        <div className="space-y-1.5 mt-2">
          <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-900 rounded px-1 transition-colors">
            <input
              type="checkbox"
              checked={!!visibleCategories.School}
              onChange={() => toggleCategory("School")}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🏫</span> Schools <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">AISHE</span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-900 rounded px-1 transition-colors">
            <input
              type="checkbox"
              checked={!!(visibleCategories.College && visibleCategories.University)}
              onChange={() => {
                const currentVal = !visibleCategories.College;
                setVisibleCategories((prev) => ({
                  ...prev,
                  College: currentVal,
                  University: currentVal,
                }));
              }}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🎓</span> Higher Education <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">AISHE</span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-900 rounded px-1 transition-colors">
            <input
              type="checkbox"
              checked={!!(visibleCategories.Industry && visibleCategories.Manufacturing)}
              onChange={() => {
                const currentVal = !visibleCategories.Industry;
                setVisibleCategories((prev) => ({
                  ...prev,
                  Industry: currentVal,
                  Manufacturing: currentVal,
                }));
              }}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🏭</span> Industrial & Mfg <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">KSPCB</span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-900 rounded px-1 transition-colors">
            <input
              type="checkbox"
              checked={!!visibleCategories.Hospital}
              onChange={() => toggleCategory("Hospital")}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🏥</span> Hospitals & Medical <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">NHA</span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-900 rounded px-1 transition-colors">
            <input
              type="checkbox"
              checked={!!visibleCategories["Apartment/Residential"]}
              onChange={() => toggleCategory("Apartment/Residential")}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🏢</span> Residential Complexes <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">RWA</span>
            </span>
          </label>
        </div>
        <div className="mt-3 pt-2 border-t border-slate-100 dark:border-zinc-850 flex items-center gap-1.5 text-[9px] text-slate-400 dark:text-zinc-500 font-mono">
          <Info size={11} className="text-indigo-500 flex-shrink-0" />
          <span>Showing {filteredMapLocations.length} active nodes</span>
        </div>
      </div>
    </div>
  );
}
