import L from "./leafletSetup";
import React from "react";
import { MapContainer, Marker, TileLayer, Tooltip } from "react-leaflet";
import { useApp } from "../../context/AppContext";

const icon = L.divIcon({ className: "", html: `<div class="bwi-marker bwi-marker-project"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });

/** Small read-only map of one location (project overview), using the same basemap as the Bengaluru map. */
export default function LocationMap({ lat, lng, label, className }: { lat: number; lng: number; label: string; className?: string }) {
  const { theme } = useApp();
  const esri = "https://server.arcgisonline.com/ArcGIS/rest/services";
  const custom = import.meta.env.VITE_MAP_TILE_URL as string | undefined;
  const tiles = custom || (theme === "dark" ? `${esri}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` : `${esri}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`);
  return (
    <MapContainer center={[lat, lng]} zoom={15} scrollWheelZoom={false} className={className} attributionControl={false}>
      <TileLayer key={tiles} url={tiles} maxNativeZoom={18} />
      <Marker position={[lat, lng]} icon={icon}>
        <Tooltip>{label}</Tooltip>
      </Marker>
    </MapContainer>
  );
}
