import React, { createContext, useContext, useState, useMemo, useCallback } from "react";
import { Location } from "../data/mockData.types";
import { MapFilters, MapLoadingStatus, MapErrorType, GooglePlaceDetails, PlacesSearchCache } from "../types/maps";
import { searchPlaces, fetchPlaceDetails } from "../services/places/placesService";

interface MapsContextType {
  filters: MapFilters;
  updateFilter: <K extends keyof MapFilters>(key: K, value: MapFilters[K]) => void;
  resetFilters: () => void;
  status: MapLoadingStatus;
  error: MapErrorType;
  isIntelligenceLoaded: boolean;
  discoveredPlaces: Location[];
  selectedPlaceDetails: GooglePlaceDetails | null;
  selectedLocation: Location | null;
  setSelectedLocation: (loc: Location | null) => void;
  viewportBounds: google.maps.LatLngBounds | null;
  setViewportBounds: (bounds: google.maps.LatLngBounds | null) => void;
  zoomLevel: number;
  setZoomLevel: (zoom: number) => void;
  loadIntelligence: (map: google.maps.Map, onSync: (locs: Location[]) => void) => Promise<void>;
  fetchPlaceDetailsAction: (map: google.maps.Map, placeId: string) => Promise<void>;
  clearSelectedLocation: () => void;
}

const MapsContext = createContext<MapsContextType | undefined>(undefined);

const initialFilters: MapFilters = {
  state: "",
  district: "",
  taluk: "",
  city: "",
  radius: 5000,
  category: "",
  subCategory: "",
  ownership: "All",
  organizationType: "",
  searchKeyword: "",
};

export const MapsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [filters, setFilters] = useState<MapFilters>(initialFilters);
  const [status, setStatus] = useState<MapLoadingStatus>("idle");
  const [error, setError] = useState<MapErrorType>(null);
  const [isIntelligenceLoaded, setIsIntelligenceLoaded] = useState(false);
  const [discoveredPlaces, setDiscoveredPlaces] = useState<Location[]>([]);
  const [selectedPlaceDetails, setSelectedPlaceDetails] = useState<GooglePlaceDetails | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [viewportBounds, setViewportBounds] = useState<google.maps.LatLngBounds | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(5);
  const [cache, setCache] = useState<PlacesSearchCache>({});

  const updateFilter = useCallback(<K extends keyof MapFilters>(key: K, value: MapFilters[K]) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(initialFilters);
    setIsIntelligenceLoaded(false);
    setDiscoveredPlaces([]);
    setSelectedLocation(null);
    setSelectedPlaceDetails(null);
    setError(null);
    setStatus("idle");
  }, []);

  // Hash filter parameters to cache searches
  const getFiltersHash = useCallback((f: MapFilters) => {
    return `${f.state}-${f.district}-${f.taluk}-${f.city}-${f.radius}-${f.category}-${f.ownership}-${f.organizationType}-${f.searchKeyword}`;
  }, []);

  const loadIntelligence = useCallback(async (map: google.maps.Map, onSync: (locs: Location[]) => void) => {
    setStatus("loading");
    setError(null);
    setSelectedLocation(null);
    setSelectedPlaceDetails(null);

    const hash = getFiltersHash(filters);

    // 1. Check Caching
    if (cache[hash]) {
      const cachedData = cache[hash];
      setDiscoveredPlaces(cachedData);
      setIsIntelligenceLoaded(true);
      setStatus("success");
      
      // Auto sync with app state
      if (cachedData.length > 0) {
        onSync(cachedData);
      }
      return;
    }

    // 2. Perform API Query
    try {
      if (!navigator.onLine) {
        throw new Error("offline");
      }

      const results = await searchPlaces(map, filters);
      
      if (results.length === 0) {
        setError("zero_results");
        setDiscoveredPlaces([]);
        setIsIntelligenceLoaded(true);
        setStatus("success");
        return;
      }

      // Add to Cache
      setCache((prev) => ({
        ...prev,
        [hash]: results,
      }));

      setDiscoveredPlaces(results);
      setIsIntelligenceLoaded(true);
      setStatus("success");

      // Synchronize results with local DB
      onSync(results);

    } catch (err: any) {
      console.error("Maps Discovery Engine Error:", err);
      const errMsg = err.message || "";
      if (errMsg === "offline" || !navigator.onLine) {
        setError("offline");
      } else if (errMsg.includes("OVER_QUERY_LIMIT") || errMsg.includes("quota")) {
        setError("quota_exceeded");
      } else {
        setError("api_failure");
      }
      setStatus("error");
    }
  }, [filters, cache, getFiltersHash]);

  const fetchPlaceDetailsAction = useCallback(async (map: google.maps.Map, placeId: string) => {
    try {
      const details = await fetchPlaceDetails(map, placeId);
      setSelectedPlaceDetails(details);
    } catch (err) {
      console.error("Failed to load place details:", err);
    }
  }, []);

  const clearSelectedLocation = useCallback(() => {
    setSelectedLocation(null);
    setSelectedPlaceDetails(null);
  }, []);

  const value = useMemo(() => ({
    filters,
    updateFilter,
    resetFilters,
    status,
    error,
    isIntelligenceLoaded,
    discoveredPlaces,
    selectedPlaceDetails,
    selectedLocation,
    setSelectedLocation,
    viewportBounds,
    setViewportBounds,
    zoomLevel,
    setZoomLevel,
    loadIntelligence,
    fetchPlaceDetailsAction,
    clearSelectedLocation,
  }), [
    filters,
    updateFilter,
    resetFilters,
    status,
    error,
    isIntelligenceLoaded,
    discoveredPlaces,
    selectedPlaceDetails,
    selectedLocation,
    viewportBounds,
    zoomLevel,
    loadIntelligence,
    fetchPlaceDetailsAction,
    clearSelectedLocation,
  ]);

  return <MapsContext.Provider value={value}>{children}</MapsContext.Provider>;
};

export const useMapsContext = () => {
  const context = useContext(MapsContext);
  if (!context) {
    throw new Error("useMapsContext must be used within a MapsProvider");
  }
  return context;
};
