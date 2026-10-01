// leaflet.markercluster is a UMD plugin that expects a global `L`. This module must be imported first.
import L from "leaflet";
import "leaflet/dist/leaflet.css";
(window as unknown as { L: typeof L }).L = L;
export default L;
