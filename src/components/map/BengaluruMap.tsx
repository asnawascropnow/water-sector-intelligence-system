import L from "./leafletSetup";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import React, { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { createPathComponent } from "@react-leaflet/core";
import { Link } from "react-router-dom";
import { CITY, ORG_TYPE_COLORS, type OrgType } from "../../../shared/constants";
import type { Organization } from "../../../shared/types";
import { useApp } from "../../context/AppContext";
import { displayUrl } from "../../lib/format";

const MarkerClusterGroup = createPathComponent<L.MarkerClusterGroup, L.MarkerClusterGroupOptions & { children?: React.ReactNode }>(
  ({ children: _c, ...options }, ctx) => {
    const instance = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 45,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: (cluster) => {
        const n = cluster.getChildCount();
        const size = n < 10 ? 30 : n < 50 ? 36 : 44;
        return L.divIcon({
          html: `<div class="bwi-cluster" style="width:${size}px;height:${size}px">${n}</div>`,
          className: "",
          iconSize: [size, size],
        });
      },
      ...options,
    });
    return { instance, context: { ...ctx, layerContainer: instance } };
  },
);

const iconCache = new Map<string, L.DivIcon>();
function iconFor(type: OrgType, inCrm: boolean) {
  const key = `${type}:${inCrm}`;
  if (!iconCache.has(key)) {
    const color = ORG_TYPE_COLORS[type] ?? ORG_TYPE_COLORS.Other;
    iconCache.set(
      key,
      L.divIcon({
        className: "",
        html: `<div class="bwi-marker${inCrm ? " bwi-marker-crm" : ""}" style="background:${color}"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -8],
      }),
    );
  }
  return iconCache.get(key)!;
}

function FocusController({ focusId, markers, openPopup }: { focusId: number | null; markers: React.MutableRefObject<Map<number, L.Marker>>; openPopup: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!focusId) return;
    const m = markers.current.get(focusId);
    if (!m) return;
    map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 16), { duration: 0.6 });
    if (!openPopup) return;
    const t = setTimeout(() => m.openPopup(), 650);
    return () => clearTimeout(t);
  }, [focusId, map, markers, openPopup]);
  return null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[12px] leading-5">
      <span className="w-20 shrink-0 text-[var(--text-3)]">{label}</span>
      <span className="text-neutral-900 break-words min-w-0">{children}</span>
    </div>
  );
}

export function OrgPopupCard({ org, onAddToCrm }: { org: Organization; onAddToCrm?: (o: Organization) => void }) {
  return (
    <div className="w-60">
      <div className="font-semibold text-[14px] text-neutral-900 mb-1.5 leading-snug">{org.name}</div>
      <Row label="Type">{org.org_type}</Row>
      <Row label="Sector">{org.sector ?? "Unknown"}</Row>
      <Row label="Area">{org.area ?? "Unknown"}</Row>
      <Row label="Phone">{org.phone ?? "Unknown"}</Row>
      <Row label="Website">
        {org.website ? (
          <a href={org.website} target="_blank" rel="noreferrer">
            {displayUrl(org.website)}
          </a>
        ) : (
          "Unknown"
        )}
      </Row>
      <Row label="Status">{org.crm_status ?? "Not Contacted"}</Row>
      <Row label="Opportunity">
        {org.intelligence?.potential ?? "Unknown"}
        {org.intelligence?.potential && org.intelligence.potential !== "Unknown" && <span className="text-[var(--text-3)]"> (AI Inference)</span>}
      </Row>
      <div className="flex gap-2 mt-2.5">
        <Link to={`/organizations/${org.id}`} className="flex-1 text-center text-[12px] font-medium rounded border border-neutral-300 px-2 py-1.5 !text-neutral-800 hover:bg-neutral-50">
          View Details
        </Link>
        {org.opportunity_id ? (
          <Link to="/crm" className="flex-1 text-center text-[12px] font-medium rounded px-2 py-1.5 bg-neutral-100 !text-neutral-700">
            In CRM
          </Link>
        ) : (
          onAddToCrm && (
            <button onClick={() => onAddToCrm(org)} className="flex-1 text-[12px] font-medium rounded px-2 py-1.5 text-white cursor-pointer" style={{ background: "var(--accent)" }}>
              Add to CRM
            </button>
          )
        )}
      </div>
    </div>
  );
}

interface Props {
  organizations: Organization[];
  focusId?: number | null;
  onAddToCrm?: (o: Organization) => void;
  className?: string;
  scrollWheelZoom?: boolean;
  /** Open the focused marker's popup (off for small preview maps). */
  openFocusPopup?: boolean;
}

export default function BengaluruMap({ organizations, focusId = null, onAddToCrm, className, scrollWheelZoom = true, openFocusPopup = true }: Props) {
  const { theme } = useApp();
  const markers = useRef(new Map<number, L.Marker>());
  const located = useMemo(() => organizations.filter((o) => o.lat != null && o.lng != null), [organizations]);
  const b = CITY.bounds;
  const pad = 0.25;
  const maxBounds = L.latLngBounds([b.south - pad, b.west - pad], [b.north + pad, b.east + pad]);
  const custom = import.meta.env.VITE_MAP_TILE_URL as string | undefined;
  const esri = "https://server.arcgisonline.com/ArcGIS/rest/services";
  const tiles = custom || (theme === "dark" ? `${esri}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}` : `${esri}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`);
  const attribution = custom
    ? (import.meta.env.VITE_MAP_TILE_ATTRIBUTION as string | undefined) ?? "&copy; OpenStreetMap contributors"
    : "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS user community";

  return (
    <MapContainer
      center={[CITY.center.lat, CITY.center.lng]}
      zoom={CITY.defaultZoom}
      minZoom={CITY.minZoom}
      maxZoom={19}
      maxBounds={maxBounds}
      maxBoundsViscosity={0.8}
      scrollWheelZoom={scrollWheelZoom}
      className={className}
      style={{ background: theme === "dark" ? "#0b0f15" : "#e8eef3" }}
    >
      <TileLayer key={tiles} url={tiles} attribution={attribution} maxNativeZoom={custom ? 19 : 18} />
      {!custom && theme === "dark" && <TileLayer key="dark-labels" url={`${esri}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`} maxNativeZoom={16} />}
      <MarkerClusterGroup>
        {located.map((o) => (
          <Marker
            key={o.id}
            position={[o.lat!, o.lng!]}
            icon={iconFor(o.org_type, Boolean(o.opportunity_id))}
            title={o.name}
            ref={(m) => {
              if (m) markers.current.set(o.id, m);
              else markers.current.delete(o.id);
            }}
          >
            <Popup maxWidth={280}>
              <OrgPopupCard org={o} onAddToCrm={onAddToCrm} />
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
      <FocusController focusId={focusId} markers={markers} openPopup={openFocusPopup} />
    </MapContainer>
  );
}
