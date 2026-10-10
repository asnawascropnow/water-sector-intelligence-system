import type { Queryable } from "../db";
import type { ProjectDuplicateCandidate, ProjectDuplicateResult } from "../../shared/types";
import { similarity } from "./duplicates";
import { normalizeName, websiteDomain } from "./normalize";

/**
 * Project duplicate detection for human review (projects are never merged automatically).
 *
 * Signals: normalised name, location (PostGIS distance), address, pincode, project type, website.
 * Construction projects are often released in phases, towers or blocks ("Lakeside Phase 1" vs
 * "Lakeside Phase 2"): when the names differ only in such a number, the match is capped at
 * "possible_duplicate" and flagged, because they are usually separate projects.
 */

const PART_WORDS = "phase|ph|tower|block|wing|stage|plot|sector|unit|building|bldg";
const PART_RE = new RegExp(`\\b(${PART_WORDS})\\s*([0-9]+|[ivx]+|[a-z])\\b`, "g");

/** Name without phase/tower/block designators, plus the designators themselves. */
export function projectNameParts(name: string) {
  const n = normalizeName(name);
  const parts: string[] = [];
  const base = n
    .replace(PART_RE, (_m, w: string, v: string) => {
      parts.push(`${w.replace(/^ph$/, "phase")} ${v}`);
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { normalized: n, base, parts: parts.sort() };
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface ProjectDupInput {
  name: string;
  address?: string | null;
  pincode?: string | null;
  project_type?: string | null;
  website?: string | null;
  lat?: number | null;
  lng?: number | null;
}

interface Row {
  id: number;
  name: string;
  normalized_name: string;
  address: string | null;
  area: string | null;
  pincode: string | null;
  project_type: string | null;
  lifecycle_stage: string;
  website: string | null;
  lat: number | null;
  lng: number | null;
}

export async function findProjectDuplicates(q: Queryable, rec: ProjectDupInput, excludeId?: number | null): Promise<ProjectDuplicateResult> {
  const me = projectNameParts(rec.name || "");
  const firstToken = me.base.split(" ").find((w) => w.length >= 3) ?? me.base;
  const domain = websiteDomain(rec.website);
  const { rows } = await q.query<Row>(
    `SELECT id, name, normalized_name, address, area, pincode, project_type, lifecycle_stage, website,
            ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
       FROM projects
      WHERE merged_into IS NULL AND ($1::int IS NULL OR id <> $1)
        AND (
             ($2 <> '' AND normalized_name LIKE '%' || $2 || '%')
          OR ($3::text IS NOT NULL AND pincode = $3)
          OR ($4::text IS NOT NULL AND website ILIKE '%' || $4 || '%')
          OR ($5::float8 IS NOT NULL AND geom IS NOT NULL AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, 500))
        )
      LIMIT 200`,
    [excludeId ?? null, firstToken, rec.pincode ?? null, domain, rec.lat ?? null, rec.lng ?? null],
  );

  const candidates: ProjectDuplicateCandidate[] = [];
  for (const r of rows) {
    const other = projectNameParts(r.name);
    const reasons: string[] = [];
    let score = 0;
    const nameSim = similarity(me.base, other.base);
    if (nameSim === 1) {
      score += 0.6;
      reasons.push("Same project name (after normalisation)");
    } else if (nameSim >= 0.8) {
      score += 0.45;
      reasons.push(`Very similar name (${Math.round(nameSim * 100)}%)`);
    } else if (nameSim >= 0.6) {
      score += 0.25;
      reasons.push(`Similar name (${Math.round(nameSim * 100)}%)`);
    }
    let distance: number | null = null;
    if (rec.lat != null && rec.lng != null && r.lat != null && r.lng != null) {
      distance = Math.round(haversineMeters(rec.lat, rec.lng, r.lat, r.lng));
      if (distance < 150) {
        score += 0.3;
        reasons.push(`Same location (${distance} m apart)`);
      } else if (distance < 500 && nameSim >= 0.5) {
        score += 0.1;
        reasons.push(`Nearby (${distance} m apart)`);
      }
    }
    if (rec.address && r.address && similarity(rec.address.toLowerCase(), r.address.toLowerCase()) >= 0.75) {
      score += 0.15;
      reasons.push("Similar address");
    }
    if (rec.pincode && r.pincode === rec.pincode && nameSim >= 0.5) {
      score += 0.1;
      reasons.push(`Same pincode (${r.pincode})`);
    }
    if (domain && websiteDomain(r.website) === domain) {
      score += 0.25;
      reasons.push("Same website");
    }
    if (rec.project_type && r.project_type) {
      if (rec.project_type === r.project_type) {
        if (score > 0) score += 0.05;
      } else {
        score -= 0.1;
        reasons.push(`Different project type (${r.project_type})`);
      }
    }
    const differentPart = (me.parts.length || other.parts.length) && me.parts.join("|") !== other.parts.join("|");
    if (differentPart && nameSim >= 0.8) reasons.push(`Different phase/tower/block (${other.parts.join(", ") || "none"} vs ${me.parts.join(", ") || "none"}) — may be a separate project`);
    if (score >= 0.35) {
      candidates.push({
        id: r.id,
        name: r.name,
        address: r.address,
        area: r.area,
        pincode: r.pincode,
        project_type: r.project_type,
        lifecycle_stage: r.lifecycle_stage,
        distance_m: distance,
        score: Math.min(1, +score.toFixed(2)),
        separate_part: Boolean(differentPart && nameSim >= 0.8),
        reasons,
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const level = !top ? "new" : top.score >= 0.85 && !top.separate_part ? "existing" : "possible_duplicate";
  return { level, candidates: candidates.slice(0, 5) };
}
