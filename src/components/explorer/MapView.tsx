import React, { useEffect, useState, useMemo } from "react";
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, InfoWindow, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Globe, BookOpen, Layers } from "lucide-react";
import { Location, Category, RwhStatus, GooglePlaceDetails } from "../../data/mockData.types";
import { fetchPlaceDetails } from "../../services/places/placesService";
import { getPolygonPaths, getMultiPolygonPaths } from "../../utils/geoConversion";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string || "";
const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string || "";

// Declarative Polygon Component for GeoJSON rendering
const GooglePolygon: React.FC<{ paths: { lat: number; lng: number }[]; options?: google.maps.PolygonOptions }> = ({ paths, options }) => {
  const map = useMap();
  const serializedPaths = JSON.stringify(paths);
  const serializedOptions = JSON.stringify(options);

  useEffect(() => {
    if (!map || typeof google === "undefined" || paths.length === 0) return;
    const polygon = new google.maps.Polygon({
      paths: JSON.parse(serializedPaths),
      ...options,
    });
    polygon.setMap(map);
    return () => { polygon.setMap(null); };
  }, [map, serializedPaths, serializedOptions]);

  return null;
};

// Declarative Rectangle Component for viewport bounds
function GoogleRectangle({ bounds, options }: { bounds: google.maps.LatLngBounds; options?: google.maps.RectangleOptions }) {
  const map = useMap();
  const serializedBounds = JSON.stringify({
    east: bounds.getNorthEast().lng(),
    north: bounds.getNorthEast().lat(),
    west: bounds.getSouthWest().lng(),
    south: bounds.getSouthWest().lat(),
  });

  useEffect(() => {
    if (!map || !bounds) return;
    const rectangle = new google.maps.Rectangle({
      bounds,
      ...options,
    });
    rectangle.setMap(map);
    return () => { rectangle.setMap(null); };
  }, [map, serializedBounds]);

  return null;
}

interface MapViewProps {
  locations: Location[];
  selectedLocation: Location | null;
  onLocationSelect: (loc: Location | null) => void;
  onOpenDrawer: () => void;
}

export default function MapView({
  locations,
  selectedLocation,
  onLocationSelect,
  onOpenDrawer,
}: MapViewProps) {
  const map = useMap();
  const placesLib = useMapsLibrary("places");

  // Selection states
  const [hoveredLocation, setHoveredLocation] = useState<Location | null>(null);
  const [activeInfoWindowId, setActiveInfoWindowId] = useState<string | null>(null);
  
  // Dynamic details fetched from Google Places
  const [googlePlaceDetails, setGooglePlaceDetails] = useState<GooglePlaceDetails | null>(null);
  const [boundaryBounds, setBoundaryBounds] = useState<google.maps.LatLngBounds | null>(null);

  // Floating filter overlays state
  const [visibleCategories, setVisibleCategories] = useState<Record<Category, boolean>>({
    School: true,
    College: true,
    University: true,
    Industry: true,
    Manufacturing: true,
    Hospital: true,
    "Apartment/Residential": true,
    Hotel: true,
    "Government Building": true,
    "Data Centre": true,
    Mining: true,
  });

  // Default Center of India
  const defaultCenter = { lat: 20.5937, lng: 78.9629 };
  const defaultZoom = 5;

  // Filter locations by visual toggle list
  const filteredMapLocations = useMemo(() => {
    return locations.filter((loc) => visibleCategories[loc.category]);
  }, [locations, visibleCategories]);

  // Fetch Google Place Details when marker selected
  useEffect(() => {
    if (!selectedLocation || !map || !placesLib) {
      setGooglePlaceDetails(null);
      setBoundaryBounds(null);
      return;
    }

    if (selectedLocation.placeId) {
      fetchPlaceDetails(map, selectedLocation.placeId)
        .then((details) => {
          setGooglePlaceDetails(details);
        })
        .catch(() => {
          setGooglePlaceDetails(null);
        });

      // Viewport boundary centering
      const service = new google.maps.places.PlacesService(map);
      service.getDetails({
        placeId: selectedLocation.placeId,
        fields: ["geometry"],
      }, (details, detailsStatus) => {
        if (detailsStatus === google.maps.places.PlacesServiceStatus.OK && details?.geometry?.viewport) {
          setBoundaryBounds(details.geometry.viewport);
          map.fitBounds(details.geometry.viewport);
        } else {
          setBoundaryBounds(null);
          map.panTo(selectedLocation.location);
          map.setZoom(16);
        }
      });
    } else {
      setGooglePlaceDetails(null);
      setBoundaryBounds(null);
      map.panTo(selectedLocation.location);
      map.setZoom(16);
    }

    setActiveInfoWindowId(selectedLocation.id);
  }, [selectedLocation, map, placesLib]);

  const toggleCategory = (cat: Category) => {
    setVisibleCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  const getRwhStatusColor = (status: RwhStatus) => {
    if (status === "verified_has_rwh") return "bg-[#E6F4EA] text-[#137333] border-[#CEEAD6]";
    if (status === "verified_no_rwh") return "bg-[#FCE8E6] text-[#C5221F] border-[#FAD2CF]";
    return "bg-[#FEF7E0] text-[#B06000] border-[#FEEFC3]";
  };

  const getRwhStatusLabel = (status: RwhStatus) => {
    if (status === "verified_has_rwh") return "HAS RWH";
    if (status === "verified_no_rwh") return "NO RWH";
    return "UNKNOWN";
  };

  return (
    <div className="w-full h-full relative" id="google-map-wrapper">
      {GOOGLE_MAPS_API_KEY ? (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} version="weekly">
          <GoogleMap
            defaultCenter={defaultCenter}
            defaultZoom={defaultZoom}
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
              if (loc.water.rainwaterHarvesting.status === "verified_has_rwh") pinColor = "#10b981"; // green
              if (loc.water.rainwaterHarvesting.status === "verified_no_rwh") pinColor = "#ef4444"; // red
              if (loc.water.rainwaterHarvesting.status === "unknown") pinColor = "#f59e0b"; // yellow/orange

              // Mapping category to emoji glyph
              let emoji = "📍";
              switch (loc.category) {
                case "School": emoji = "🏫"; break;
                case "College":
                case "University": emoji = "🎓"; break;
                case "Industry":
                case "Manufacturing": emoji = "🏭"; break;
                case "Hospital": emoji = "🏥"; break;
                case "Apartment/Residential": emoji = "🏢"; break;
                case "Hotel": emoji = "🏨"; break;
                case "Government Building": emoji = "🏛️"; break;
                case "Data Centre": emoji = "🗄️"; break;
                case "Mining": emoji = "⛏️"; break;
              }

              return (
                <React.Fragment key={loc.id}>
                  {/* Render GeoJSON property boundary if available */}
                  {loc.geometry?.geojson && (
                    <>
                      {loc.geometry.geojson.type === "Polygon" && (
                        <GooglePolygon
                          paths={getPolygonPaths(loc.geometry.geojson)[0] || []}
                          options={{
                            strokeColor: isSelected ? "#EA580C" : pinColor,
                            strokeOpacity: 0.8,
                            strokeWeight: isSelected ? 3.5 : 1.5,
                            fillColor: isSelected ? "#EA580C" : pinColor,
                            fillOpacity: isSelected ? 0.38 : 0.12,
                          }}
                        />
                      )}
                      {loc.geometry.geojson.type === "MultiPolygon" && 
                        getMultiPolygonPaths(loc.geometry.geojson).map((polyPaths, pIdx) => (
                          <GooglePolygon
                            key={`${loc.id}-poly-${pIdx}`}
                            paths={polyPaths[0] || []}
                            options={{
                              strokeColor: isSelected ? "#EA580C" : pinColor,
                              strokeOpacity: 0.8,
                              strokeWeight: isSelected ? 3.5 : 1.5,
                              fillColor: isSelected ? "#EA580C" : pinColor,
                              fillOpacity: isSelected ? 0.38 : 0.12,
                            }}
                          />
                        ))
                      }
                    </>
                  )}

                  {/* Draw Google Places bounds Rectangle when selected */}
                  {isSelected && boundaryBounds && (
                    <GoogleRectangle
                      bounds={boundaryBounds}
                      options={{
                        strokeColor: "#1A73E8",
                        strokeOpacity: 0.85,
                        strokeWeight: 3,
                        fillColor: "#1A73E8",
                        fillOpacity: 0.12,
                        clickable: false,
                      }}
                    />
                  )}

                  {/* Advanced Marker */}
                  <AdvancedMarker
                    position={loc.location}
                    onClick={() => {
                      onLocationSelect(loc);
                      setActiveInfoWindowId(loc.id);
                    }}
                    onMouseEnter={() => setHoveredLocation(loc)}
                    onMouseLeave={() => setHoveredLocation(null)}
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

            {/* Hover Tooltip InfoWindow */}
            {hoveredLocation && (!selectedLocation || selectedLocation.id !== hoveredLocation.id) && (
              <InfoWindow
                position={hoveredLocation.location}
                options={{ disableAutoPan: true, headerDisabled: true }}
              >
                <div className="p-1.5 text-xs font-sans text-slate-800 pointer-events-none min-w-[150px]">
                  <p className="font-extrabold m-0 text-slate-900 leading-tight">{hoveredLocation.name}</p>
                  <p className="text-[10px] text-slate-500 m-0 mt-0.5">
                    {hoveredLocation.category} • {hoveredLocation.water.estimatedRoofArea ? Math.round(hoveredLocation.water.estimatedRoofArea * 4 / 4046.86) : 0} ac
                  </p>
                  <div className="text-[9px] font-extrabold text-indigo-600 mt-1 uppercase tracking-wide">
                    Stress: {hoveredLocation.water.waterStressLevel}
                  </div>
                </div>
              </InfoWindow>
            )}

            {/* Click Details InfoWindow */}
            {selectedLocation && activeInfoWindowId === selectedLocation.id && (
              <InfoWindow
                position={selectedLocation.location}
                onCloseClick={() => {
                  setActiveInfoWindowId(null);
                  onLocationSelect(null);
                }}
              >
                <div className="p-2 min-w-[240px] max-w-[280px] text-slate-800 font-sans">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-sm" title={selectedLocation.category}>
                      {selectedLocation.category === "School" && "🏫"}
                      {(selectedLocation.category === "College" || selectedLocation.category === "University") && "🎓"}
                      {(selectedLocation.category === "Industry" || selectedLocation.category === "Manufacturing") && "🏭"}
                      {selectedLocation.category === "Hospital" && "🏥"}
                      {selectedLocation.category === "Apartment/Residential" && "🏢"}
                      {selectedLocation.category === "Hotel" && "🏨"}
                      {selectedLocation.category === "Government Building" && "🏛️"}
                      {selectedLocation.category === "Data Centre" && "🗄️"}
                      {selectedLocation.category === "Mining" && "⛏️"}
                    </span>
                    <h6 className="font-bold text-[13px] leading-tight m-0 truncate flex-1 text-slate-900">
                      {selectedLocation.name}
                    </h6>
                  </div>
                  <p className="text-[11px] text-slate-500 m-0 mb-2 truncate">
                    {selectedLocation.district}, {selectedLocation.state}
                  </p>

                  <div className="text-[10px] space-y-1 mb-2.5 bg-slate-50 p-2 rounded border border-slate-100">
                    <div className="flex justify-between">
                      <span className="text-slate-500">📐 Roof Area:</span> 
                      <span className="font-medium">
                        {selectedLocation.water.estimatedRoofArea ? `${selectedLocation.water.estimatedRoofArea.toLocaleString()} m²` : "N/A"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">💧 Source:</span> 
                      <span className="font-medium">{selectedLocation.water.waterSource}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">🌊 Stress:</span> 
                      <span className="font-medium text-red-650 dark:text-red-400">{selectedLocation.water.waterStressLevel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">🌧️ Verified:</span> 
                      <span className="font-medium">{selectedLocation.water.rainwaterHarvesting.verified ? "Yes" : "No"}</span>
                    </div>
                    
                    {googlePlaceDetails && (
                      <div className="pt-1.5 mt-1.5 border-t border-slate-200/60 space-y-1 text-[9.5px]">
                        {googlePlaceDetails.formattedAddress && (
                          <div className="text-slate-600 leading-normal">
                            <span className="font-semibold text-slate-700">📍 Address:</span> {googlePlaceDetails.formattedAddress}
                          </div>
                        )}
                        {googlePlaceDetails.website && (
                          <div>
                            <span className="font-semibold text-slate-700">🌐 Website:</span>{" "}
                            <a href={googlePlaceDetails.website} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline break-all">
                              {googlePlaceDetails.website.replace(/^https?:\/\/(www\.)?/, "")}
                            </a>
                          </div>
                        )}
                        {googlePlaceDetails.formattedPhoneNumber && (
                          <div><span className="font-semibold text-slate-700">☎️ Phone:</span> {googlePlaceDetails.formattedPhoneNumber}</div>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <span
                      className={`text-[9px] font-extrabold px-1.5 py-0.5 border rounded-sm tracking-wide ${getRwhStatusColor(
                        selectedLocation.water.rainwaterHarvesting.status
                      )}`}
                    >
                      {getRwhStatusLabel(selectedLocation.water.rainwaterHarvesting.status)}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDrawer();
                      }}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold px-2.5 py-1 rounded transition-all cursor-pointer shadow-sm border-0"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
          
          {/* Floating Map Reset Controls Panel */}
          <div className="absolute bottom-5 right-5 z-[500] flex flex-col gap-2">
            <button
              onClick={() => {
                onLocationSelect(null);
                setActiveInfoWindowId(null);
                setBoundaryBounds(null);
                setGooglePlaceDetails(null);
              }}
              className="bg-white/95 dark:bg-[#09090b]/95 text-slate-800 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 px-3.5 py-2.5 rounded border border-slate-200 dark:border-zinc-800 shadow-md flex items-center gap-2 text-xs font-semibold cursor-pointer transition-all hover:scale-[1.02] shadow-indigo-100/40 dark:shadow-none"
              title="Reset Map to India National View"
            >
              <Globe size={13} className="text-indigo-600 dark:text-indigo-400" />
              <span>Reset Map View</span>
            </button>
          </div>
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
        <div className="space-y-1.5 mt-2 max-h-[180px] overflow-y-auto pr-1">
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
              checked={!!visibleCategories.College}
              onChange={() => toggleCategory("College")}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🎓</span> Colleges <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">AISHE</span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-900 rounded px-1 transition-colors">
            <input
              type="checkbox"
              checked={!!visibleCategories.University}
              onChange={() => toggleCategory("University")}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🎓</span> Universities <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">AISHE</span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-900 rounded px-1 transition-colors">
            <input
              type="checkbox"
              checked={!!visibleCategories.Industry}
              onChange={() => toggleCategory("Industry")}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🏭</span> Industries <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">KSPCB</span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer py-0.5 hover:bg-slate-50 dark:hover:bg-zinc-900 rounded px-1 transition-colors">
            <input
              type="checkbox"
              checked={!!visibleCategories.Manufacturing}
              onChange={() => toggleCategory("Manufacturing")}
              className="accent-indigo-600 rounded text-indigo-600"
            />
            <span className="text-[11px] flex items-center gap-1.5 flex-1 text-slate-700 dark:text-zinc-200">
              <span>🏭</span> Manufacturing <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">KSPCB</span>
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
              <span>🏥</span> Hospitals <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">NIDM</span>
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
              <span>🏢</span> Apartments <span className="text-[9.5px] text-slate-400 dark:text-zinc-500 font-mono ml-auto">RERA</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
