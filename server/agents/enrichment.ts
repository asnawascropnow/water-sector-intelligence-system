import dns from "node:dns/promises";
import net from "node:net";
import type { Queryable } from "../db";
import { geocodeAddress, geocoderEnabled } from "../lib/geocode";
import { inferOrgType, normalizeEmail, normalizePhone, websiteDomain } from "../lib/normalize";
import { llmEnabled, llmResearchOrganization } from "../extraction/llm";

/**
 * Agent 2 — Organization Enrichment Agent.
 * Gathers publicly available information and stores it as *suggestions* (agent_recommendations, agent = 'enrichment').
 * Nothing is written to the organization until a person accepts a suggestion. Every suggestion keeps its source.
 */

export interface EnrichmentSuggestion {
  field: "website" | "phone" | "email" | "sector" | "org_type" | "address" | "location" | "water_info";
  value: string | { lat: number; lng: number };
  source: string;
  provenance: "Unverified" | "Estimated" | "AI Inference";
  note?: string;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80") || ip.startsWith("::ffff:127.");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** Fetch a public web page safely (http/https only, no private network targets, size and time limits). */
async function fetchPublicPage(url: string): Promise<string | null> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) return null;
  const { address } = await dns.lookup(u.hostname);
  if (isPrivateIp(address)) return null;
  const res = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(10000), headers: { "User-Agent": "Mozilla/5.0 (BengaluruWaterIntelligence enrichment)" } });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
  const text = await res.text();
  return text.slice(0, 1_500_000);
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const WATER_TERMS = /[^.]{0,160}\b(rainwater harvesting|sewage treatment plant|effluent treatment|zero liquid discharge|ZLD|STP|ETP|borewell|water recycling|water conservation|water positive|water neutral)\b[^.]{0,160}\./gi;

async function fromWebsite(org: OrgRow): Promise<EnrichmentSuggestion[]> {
  if (!org.website) return [];
  const html = await fetchPublicPage(org.website).catch(() => null);
  if (!html) return [];
  const src = org.website;
  const out: EnrichmentSuggestion[] = [];
  const text = htmlToText(html);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1]?.trim();

  if (!org.email) {
    const domain = websiteDomain(org.website);
    const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => normalizeEmail(e)!).filter(Boolean))];
    const best = emails.find((e) => domain && e.endsWith(domain)) ?? emails[0];
    if (best) out.push({ field: "email", value: best, source: src, provenance: "Unverified", note: "Found on the organization's website" });
  }
  if (!org.phone) {
    const phone = text.match(/(?:\+91[\s-]?)?(?:0?80[\s-]?\d{4}[\s-]?\d{4}|[6-9]\d{4}[\s-]?\d{5})/)?.[0];
    if (phone) out.push({ field: "phone", value: normalizePhone(phone)!, source: src, provenance: "Unverified", note: "Found on the organization's website" });
  }
  if (org.org_type === "Other") {
    const t = inferOrgType(`${title ?? ""} ${description ?? ""}`);
    if (t) out.push({ field: "org_type", value: t, source: src, provenance: "AI Inference", note: "Inferred from website title/description" });
  }
  if (!org.sector && description) {
    out.push({ field: "sector", value: description.slice(0, 160), source: src, provenance: "Unverified", note: "Website meta description — edit into a short sector label" });
  }
  const waterMentions = [...new Set((text.match(WATER_TERMS) ?? []).map((s) => s.trim()))].slice(0, 3);
  for (const w of waterMentions) out.push({ field: "water_info", value: w, source: src, provenance: "Unverified", note: "Water-related statement on the website" });
  return out;
}

async function fromGeocoder(org: OrgRow): Promise<EnrichmentSuggestion[]> {
  if (org.lat != null || !geocoderEnabled()) return [];
  const hit = await geocodeAddress(org);
  if (!hit) return [];
  return [{ field: "location", value: { lat: hit.lat, lng: hit.lng }, source: `OpenStreetMap Nominatim: ${hit.label}`, provenance: "Estimated", note: `Geocoded from address (${hit.precision} precision)` }];
}

async function fromWebSearch(org: OrgRow): Promise<EnrichmentSuggestion[]> {
  if (!llmEnabled()) return [];
  const findings = await llmResearchOrganization(org).catch(() => []);
  return findings
    .filter((f) => f.field === "water_info" || !(org as unknown as Record<string, unknown>)[f.field])
    .map((f) => ({ field: f.field, value: f.value, source: f.source, provenance: "AI Inference" as const, note: "Found via AI web research" }));
}

interface OrgRow {
  id: number;
  pincode: string | null;
  name: string;
  org_type: string;
  sector: string | null;
  address: string | null;
  area: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  lat: number | null;
}

export async function enrichOrganization(q: Queryable, orgId: number): Promise<{ added: number; sourcesTried: string[] }> {
  const { rows } = await q.query<OrgRow>(
    `SELECT id, name, org_type, sector, address, area, pincode, website, phone, email, ST_Y(geom::geometry) AS lat FROM organizations WHERE id = $1`,
    [orgId],
  );
  const org = rows[0];
  if (!org) throw new Error("Organization not found");
  const sourcesTried: string[] = [];
  const suggestions: EnrichmentSuggestion[] = [];
  if (org.website) {
    sourcesTried.push("Organization website");
    suggestions.push(...(await fromWebsite(org)));
  }
  if (org.lat == null && geocoderEnabled()) {
    sourcesTried.push("OpenStreetMap geocoder");
    suggestions.push(...(await fromGeocoder(org)));
  }
  if (llmEnabled()) {
    sourcesTried.push("AI web research");
    suggestions.push(...(await fromWebSearch(org)));
  }
  let added = 0;
  for (const s of suggestions) {
    const valueKey = typeof s.value === "string" ? s.value.toLowerCase().slice(0, 80) : `${s.value.lat.toFixed(5)},${s.value.lng.toFixed(5)}`;
    const res = await q.query<{ id: number }>(
      `INSERT INTO agent_recommendations (agent, dedupe_key, organization_id, action_type, title, reason, priority, payload)
       VALUES ('enrichment', $1, $2, 'apply_field', $3, $4, 'Low', $5)
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [
        `enrich:${orgId}:${s.field}:${valueKey}`,
        orgId,
        `Suggested ${s.field.replace("_", " ")} for ${org.name}`,
        `${s.note ?? "Publicly available information"}. Source: ${s.source}. Label: ${s.provenance}.`,
        JSON.stringify(s),
      ],
    );
    added += res.rows.length;
  }
  return { added, sourcesTried };
}
