import { CITY } from "../../shared/constants";
import { inBengaluru } from "./normalize";

export const geocoderEnabled = () => (process.env.GEOCODER ?? "nominatim") === "nominatim";

const cache = new Map<string, { lat: number; lng: number; label: string } | null>();
let last = 0;

/**
 * Geocode an address with OpenStreetMap Nominatim, restricted to the Bengaluru bounding box.
 * Respects the public usage policy (≤1 request/second, identifying User-Agent).
 * Returns null when nothing credible is found — callers must then leave the location Unknown.
 */
export async function geocode(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  if (!geocoderEnabled()) return null;
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key)!;

  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();

  const b = CITY.bounds;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", /beng|bang/i.test(query) ? query : `${query}, ${CITY.name}`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "in");
  url.searchParams.set("viewbox", `${b.west},${b.north},${b.east},${b.south}`);
  url.searchParams.set("bounded", "1");
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": process.env.GEOCODER_USER_AGENT || "BengaluruWaterIntelligence/0.1 (internal MVP)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    const result = hit && inBengaluru(+hit.lat, +hit.lon) ? { lat: +hit.lat, lng: +hit.lon, label: hit.display_name } : null;
    cache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * Try progressively coarser queries: full address → address without house/plot details → area → pincode.
 * The precision used is returned so the location can be labelled honestly (Estimated).
 */
export async function geocodeAddress(parts: { name?: string | null; address?: string | null; area?: string | null; pincode?: string | null }) {
  const tries: { q: string; precision: string }[] = [];
  const addr = parts.address?.replace(/\b(bengaluru|bangalore)\b[\s,-]*\d{0,6}/gi, "").trim().replace(/,\s*$/, "");
  if (addr) {
    tries.push({ q: [addr, parts.pincode].filter(Boolean).join(", "), precision: "address" });
    const segs = addr.split(",").map((s) => s.trim()).filter(Boolean);
    const trimmed = segs.filter((s) => !/^(plot|no\.?|#|door|flat|site|survey|sy\.?|shed|building|bldg|floor|\d+[a-z]?\b)/i.test(s));
    if (trimmed.length && trimmed.length < segs.length) tries.push({ q: trimmed.join(", "), precision: "street/locality" });
  }
  if (parts.area) tries.push({ q: parts.area, precision: "area centre" });
  if (parts.pincode) tries.push({ q: parts.pincode, precision: "pincode centre" });
  for (const t of tries) {
    const hit = await geocode(t.q);
    if (hit) return { ...hit, precision: t.precision };
  }
  return null;
}
