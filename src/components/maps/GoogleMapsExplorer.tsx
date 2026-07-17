import React, { useEffect, useState, useMemo } from "react";
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Globe, AlertTriangle, Loader2, Landmark, GraduationCap, Building2, Hospital, Building, Bed, Hammer, Cpu } from "lucide-react";
import { Location } from "../../data/mockData.types";
import { useMapsIntelligence } from "../../hooks/useMapsIntelligence";
import { clusterMarkers, MarkerCluster, isPointInBounds } from "../../utils/geoUtils";
import { getPolygonPaths, getMultiPolygonPaths } from "../../utils/geoConversion";

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string || "";
const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string || "";

// Declarative Rectangle Component for viewport bounds
function GoogleRectangle({ bounds }: { bounds: google.maps.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    if (!map || !bounds) return;
    const rectangle = new google.maps.Rectangle({
      bounds,
      strokeColor: "#1A73E8",
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: "#1A73E8",
      fillOpacity: 0.08,
      clickable: false,
    });
    rectangle.setMap(map);
    return () => { rectangle.setMap(null); };
  }, [map, bounds]);
  return null;
}

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

interface GoogleMapsExplorerProps {
  onSyncLocations: (locs: Location[]) => void;
  onOpenDetails: (loc: Location) => void;
}

export default function GoogleMapsExplorer({ onSyncLocations, onOpenDetails }: GoogleMapsExplorerProps) {
  const {
    filters,
    status,
    error,
    isIntelligenceLoaded,
    discoveredPlaces,
    selectedLocation,
    setSelectedLocation,
    viewportBounds,
    setViewportBounds,
    zoomLevel,
    setZoomLevel,
    loadIntelligence,
    fetchPlaceDetailsAction,
    isFiltersValid,
    clearSelectedLocation,
  } = useMapsIntelligence();

  const map = useMap();
  const placesLib = useMapsLibrary("places");
  const [activeBoundary, setActiveBoundary] = useState<google.maps.LatLngBounds | null>(null);

  // Default Center of India
  const defaultCenter = useMemo(() => ({ lat: 20.5937, lng: 78.9629 }), []);
  const defaultZoom = 5;

  // Handle map camera bounds/zoom update on load
  const onCameraChange = () => {
    if (!map) return;
    setZoomLevel(map.getZoom() || defaultZoom);
    setViewportBounds(map.getBounds() || null);
  };

  // Sync place boundary geometry
  useEffect(() => {
    if (!selectedLocation) {
      setActiveBoundary(null);
      return;
    }
    
    // Check if place contains a Google Maps viewport geometry
    if (selectedLocation.placeId && map && placesLib) {
      const service = new google.maps.places.PlacesService(map);
      service.getDetails({
        placeId: selectedLocation.placeId,
        fields: ["geometry"],
      }, (details, detailsStatus) => {
        if (detailsStatus === google.maps.places.PlacesServiceStatus.OK && details?.geometry?.viewport) {
          setActiveBoundary(details.geometry.viewport);
          map.fitBounds(details.geometry.viewport);
        } else {
          setActiveBoundary(null);
          map.panTo(selectedLocation.location);
          map.setZoom(16);
        }
      });
    } else {
      setActiveBoundary(null);
      map.panTo(selectedLocation.location);
      map.setZoom(16);
    }
  }, [selectedLocation, map, placesLib]);

  // Load action trigger
  const handleLoadClick = () => {
    if (map && isFiltersValid) {
      loadIntelligence(map, onSyncLocations);
    }
  };

  // Lazy render & cluster markers inside viewport
  const visiblePlaces = useMemo(() => {
    return discoveredPlaces.filter(loc => isPointInBounds(loc.location.lat, loc.location.lng, viewportBounds));
  }, [discoveredPlaces, viewportBounds]);

  const clusteredItems = useMemo(() => {
    return clusterMarkers(visiblePlaces, zoomLevel);
  }, [visiblePlaces, zoomLevel]);

  // Cluster Click handler
  const handleClusterClick = (cluster: MarkerCluster) => {
    if (map) {
      map.panTo({ lat: cluster.lat, lng: cluster.lng });
      map.setZoom(zoomLevel + 2);
    }
  };

  // Marker Click handler
  const handleMarkerClick = (loc: Location) => {
    setSelectedLocation(loc);
    if (map && loc.placeId) {
      fetchPlaceDetailsAction(map, loc.placeId);
    }
    onOpenDetails(loc);
  };

  // Emojis mapping
  const getMarkerEmoji = (category: string) => {
    switch (category) {
      case "School": return "🏫";
      case "College":
      case "University": return "🎓";
      case "Hospital": return "🏥";
      case "Apartment/Residential": return "🏢";
      case "Hotel": return "🏨";
      case "Government Building": return "🏛️";
      case "Data Centre": return "🗄️";
      case "Mining": return "⛏️";
      case "Manufacturing":
      case "Industry": return "🏭";
      default: return "📍";
    }
  };

  return (
    <div className="w-full h-full relative" id="maps-discovery-pane">
      {/* Search status notification banner */}
      {status === "loading" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-slate-900/90 text-white px-4 py-2.5 rounded-md shadow-md flex items-center gap-2.5 text-xs font-semibold backdrop-blur-md border border-slate-700/50">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          <span>Searching Google Places Database...</span>
        </div>
      )}

      {/* Error Banners */}
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-red-50 dark:bg-red-950/90 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-900/50 px-4 py-3 rounded-md shadow-md flex items-start gap-3 max-w-sm text-xs font-medium backdrop-blur-md">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h6 className="font-extrabold m-0 text-red-900 dark:text-red-400">
              {error === "quota_exceeded" && "Google API Quota Exceeded"}
              {error === "zero_results" && "No Results Found"}
              {error === "offline" && "No Network Connection"}
              {error === "api_failure" && "Discovery Service Error"}
            </h6>
            <p className="m-0 mt-1 text-[11px] leading-normal opacity-90">
              {error === "quota_exceeded" && "The Google Places API limit has been reached. Please verify billing settings in your developer portal."}
              {error === "zero_results" && "No locations matched your specific filters. Try expanding the search radius or changing categories."}
              {error === "offline" && "Your device appears to be offline. Reconnect to the internet to perform live Google searches."}
              {error === "api_failure" && "There was an unexpected error communicating with Google services. Please try again later."}
            </p>
          </div>
        </div>
      )}

      {/* Blurry Loading Filter Overlay */}
      {!isIntelligenceLoaded && (
        <div className="absolute inset-0 z-[600] flex items-center justify-center bg-slate-100/30 dark:bg-black/40 backdrop-blur-[7px]">
          <div className="bg-white/95 dark:bg-[#09090b]/95 border border-slate-200 dark:border-zinc-850 p-6 rounded-md shadow-xl max-w-sm text-center space-y-4 font-sans text-slate-800 dark:text-zinc-200 mx-4">
            <Globe className="w-10 h-10 text-indigo-600 dark:text-indigo-400 mx-auto" />
            <div>
              <h4 className="font-extrabold text-sm uppercase tracking-wider text-slate-900 dark:text-white">Spatial Intelligence Lock</h4>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1.5 leading-relaxed">
                To prevent nationwide quota exhaustion, Google Places API querying is locked on load.
              </p>
            </div>
            
            <div className="p-3 bg-slate-50 dark:bg-zinc-950/40 rounded border border-slate-150 dark:border-zinc-900 text-left space-y-1.5 text-[11px]">
              <div className="font-bold text-slate-400 uppercase text-[9px] tracking-widest pb-1 border-b border-slate-100 dark:border-zinc-850">
                Setup Criteria (Min 3 required)
              </div>
              <div className="flex items-center justify-between">
                <span>1. State Boundaries</span>
                <span className="font-bold">{filters.state ? "✓ Active" : "✗ Missing"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>2. District Boundaries</span>
                <span className="font-bold">{filters.district ? "✓ Active" : "✗ Missing"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>3. Category / Org Type</span>
                <span className="font-bold">{(filters.category || filters.organizationType) ? "✓ Active" : "✗ Missing"}</span>
              </div>
            </div>

            <button
              onClick={handleLoadClick}
              disabled={!isFiltersValid || status === "loading"}
              className={`w-full font-bold text-xs uppercase py-2.5 rounded transition-all cursor-pointer border-0 flex items-center justify-center gap-2 shadow-sm ${
                isFiltersValid && status !== "loading"
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white hover:scale-[1.01]"
                  : "bg-slate-200 dark:bg-zinc-800 text-slate-455 dark:text-zinc-500 cursor-not-allowed"
              }`}
            >
              {status === "loading" ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading GIS Layers...</span>
                </>
              ) : (
                <span>Load Live Intelligence</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Google Map Container */}
      <div className={`w-full h-full ${!isIntelligenceLoaded ? "blur-[2px] opacity-40 select-none pointer-events-none" : ""}`}>
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
              onCameraChanged={onCameraChange}
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            >
              {/* Dynamic Boundary Rectangle */}
              {activeBoundary && <GoogleRectangle bounds={activeBoundary} />}

              {/* Render Clustered Map Elements */}
              {clusteredItems.map((item) => {
                const isCluster = (item as any).count !== undefined;

                if (isCluster) {
                  const cluster = item as MarkerCluster;
                  return (
                    <AdvancedMarker
                      key={cluster.id}
                      position={{ lat: cluster.lat, lng: cluster.lng }}
                      onClick={() => handleClusterClick(cluster)}
                    >
                      <div className="w-8 h-8 rounded-full bg-indigo-600 border-2 border-white dark:border-zinc-950 flex items-center justify-center text-white text-xs font-black shadow-md cursor-pointer hover:scale-105 transition-all hover:bg-indigo-500">
                        {cluster.count}
                      </div>
                    </AdvancedMarker>
                  );
                }

                // Standard Location Marker
                const loc = item as Location;
                const isSelected = selectedLocation?.id === loc.id;
                
                let pinColor = "#3b82f6"; // blue
                if (loc.water.rainwaterHarvesting.status === "verified_has_rwh") pinColor = "#10b981"; // green
                if (loc.water.rainwaterHarvesting.status === "verified_no_rwh") pinColor = "#ef4444"; // red
                if (loc.water.rainwaterHarvesting.status === "unknown") pinColor = "#f59e0b"; // amber

                const emoji = getMarkerEmoji(loc.category);

                return (
                  <React.Fragment key={loc.id}>
                    {/* Render GeoJSON boundary if available */}
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

                    <AdvancedMarker
                      position={loc.location}
                      onClick={() => handleMarkerClick(loc)}
                    >
                      <Pin
                        background={pinColor}
                        borderColor={isSelected ? "#ea580c" : "#ffffff"}
                        glyph={emoji}
                        scale={isSelected ? 1.25 : 1.0}
                      />
                    </AdvancedMarker>
                  </React.Fragment>
                );
              })}
            </GoogleMap>
          </APIProvider>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-sm text-slate-500 bg-white">
            Google Maps API Key missing. Please check VITE_GOOGLE_MAPS_API_KEY.
          </div>
        )}
      </div>

      {/* Floating Map Reset Controls Panel */}
      {isIntelligenceLoaded && (
        <div className="absolute bottom-5 right-5 z-[500] flex flex-col gap-2 pointer-events-auto">
          <button
            onClick={() => {
              clearSelectedLocation();
              if (map) {
                map.setCenter(defaultCenter);
                map.setZoom(defaultZoom);
              }
            }}
            className="bg-white/95 dark:bg-[#09090b]/95 text-slate-800 dark:text-zinc-200 hover:bg-slate-50 dark:hover:bg-zinc-900 px-3.5 py-2.5 rounded border border-slate-200 dark:border-zinc-800 shadow-md flex items-center gap-2 text-xs font-semibold cursor-pointer transition-all hover:scale-[1.02] shadow-indigo-100/40 dark:shadow-none"
            title="Reset Map to India National View"
          >
            <Globe size={13} className="text-indigo-600 dark:text-indigo-400" />
            <span>Reset Map View</span>
          </button>
        </div>
      )}
    </div>
  );
}
