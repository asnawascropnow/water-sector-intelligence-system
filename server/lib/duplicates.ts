import type { Queryable } from "../db";
import type { DuplicateCandidate, DuplicateResult, OrganizationInput } from "../../shared/types";
import { corporateEmailDomain, normalizeName, phoneKey, websiteDomain } from "./normalize";

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice similarity on character bigrams (0..1). */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0);
    total += n;
  }
  for (const n of B.values()) total += n;
  return total ? (2 * inter) / total : 0;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface CandidateRow {
  id: number;
  name: string;
  normalized_name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Check a record against existing organizations using name, address, phone, website and location.
 * "existing"  → confidently the same organization
 * "possible_duplicate" → needs a human decision
 * "new" → no meaningful match
 */
export async function findDuplicates(q: Queryable, rec: OrganizationInput, excludeId?: number): Promise<DuplicateResult> {
  const norm = normalizeName(rec.name || "");
  const pk = phoneKey(rec.phone);
  const domain = websiteDomain(rec.website);
  const emailDomain = corporateEmailDomain(rec.email);
  const firstToken = norm.split(" ").find((w) => w.length >= 3) ?? norm;

  // Pre-filter in SQL (index-friendly), then score in JS.
  const { rows } = await q.query<CandidateRow>(
    `SELECT id, name, normalized_name, address, phone, website, email,
            ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
       FROM organizations
      WHERE merged_into IS NULL AND ($1::int IS NULL OR id <> $1)
        AND (
             normalized_name LIKE '%' || $2 || '%'
          OR ($3::text IS NOT NULL AND right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = $3)
          OR ($4::text IS NOT NULL AND website ILIKE '%' || $4 || '%')
          OR ($5::text IS NOT NULL AND email ILIKE '%@' || $5)
          OR ($6::float8 IS NOT NULL AND geom IS NOT NULL
              AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, 400))
        )
      LIMIT 200`,
    [excludeId ?? null, firstToken, pk, domain, emailDomain, rec.lat ?? null, rec.lng ?? null],
  );

  const candidates: DuplicateCandidate[] = [];
  for (const r of rows) {
    const reasons: string[] = [];
    let score = 0;
    const nameSim = similarity(norm, r.normalized_name);
    if (nameSim === 1) {
      score += 0.6;
      reasons.push("Same name (after normalisation)");
    } else if (nameSim >= 0.8) {
      score += 0.45;
      reasons.push(`Very similar name (${Math.round(nameSim * 100)}%)`);
    } else if (nameSim >= 0.6) {
      score += 0.25;
      reasons.push(`Similar name (${Math.round(nameSim * 100)}%)`);
    }
    if (pk && phoneKey(r.phone) === pk) {
      score += 0.35;
      reasons.push("Same phone number");
    }
    if (domain && websiteDomain(r.website) === domain) {
      score += 0.35;
      reasons.push("Same website");
    }
    if (emailDomain && corporateEmailDomain(r.email) === emailDomain) {
      score += 0.2;
      reasons.push("Same email domain");
    }
    if (rec.lat != null && rec.lng != null && r.lat != null && r.lng != null) {
      const d = haversineMeters(rec.lat, rec.lng, r.lat, r.lng);
      if (d < 75) {
        score += 0.25;
        reasons.push(`Same location (${Math.round(d)} m apart)`);
      } else if (d < 400 && nameSim >= 0.5) {
        score += 0.1;
        reasons.push(`Nearby (${Math.round(d)} m apart)`);
      }
    }
    if (rec.address && r.address) {
      const addrSim = similarity(rec.address.toLowerCase(), r.address.toLowerCase());
      if (addrSim >= 0.75) {
        score += 0.15;
        reasons.push("Similar address");
      }
    }
    if (score >= 0.35) {
      candidates.push({ id: r.id, name: r.name, address: r.address, phone: r.phone, website: r.website, score: Math.min(1, +score.toFixed(2)), reasons });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const level = !top ? "new" : top.score >= 0.85 ? "existing" : "possible_duplicate";
  return { level, candidates: candidates.slice(0, 5) };
}
