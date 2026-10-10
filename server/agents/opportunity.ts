import type { Queryable } from "../db";
import type { DataConfidence, OrgType, Potential } from "../../shared/constants";
import type { FieldSource, Intelligence, WaterInfo } from "../../shared/types";

/**
 * Agent 3 — Opportunity Agent.
 * Transparent, rule-based assessment of how relevant an organization is for water / Net Zero solutions.
 * Uses only data already on the record; every conclusion carries its reasons and is labelled "AI Inference".
 * Missing data lowers confidence — it is never filled in.
 */

const TYPE_WEIGHT: Record<OrgType, { score: number; reason: string } | null> = {
  Manufacturing: { score: 3, reason: "Manufacturing facility — process water, cooling and effluent treatment needs are common" },
  Industrial: { score: 2.5, reason: "Industrial site — typically significant water use and effluent handling" },
  Hospital: { score: 3, reason: "Hospital — continuous, high water demand (sterilisation, laundry, HVAC) and STP obligations" },
  Hotel: { score: 2.5, reason: "Hotel — high per-guest water use, laundry, kitchens and STP requirements" },
  "IT / Technology": { score: 2, reason: "IT / technology campus — large occupancy, cooling towers and STP recycling potential" },
  "College / University": { score: 2, reason: "College / university campus — large roof and land area, hostels and STP" },
  Apartment: { score: 2, reason: "Apartment complex — borewell/tanker dependence and mandatory STP/RWH are common in Bengaluru" },
  Commercial: { score: 1.5, reason: "Commercial property — HVAC and occupancy-driven water demand" },
  Institution: { score: 1, reason: "Institution — moderate water use depending on campus size" },
  School: { score: 1, reason: "School — moderate water use; rainwater harvesting opportunity" },
  Government: { score: 1, reason: "Government building — moderate water use; slower procurement cycles" },
  Other: null,
};

const WATER_INTENSIVE_SECTOR =
  /\b(textile|dyeing|garment|laundry|pharma\w*|chemical|food|beverage|brewer\w*|distiller\w*|dairy|bottling|paper|electroplating|plating|metal finishing|automotive|auto components?|foundry|castings?|data cent(er|re)|semiconductor|electronics|paint|leather|hospitality|biotech\w*)\b/i;
const WATER_SIGNAL = /\b(borewell|bore well|tanker|stp|etp|zld|zero liquid|effluent|groundwater|water scarcity|water shortage|recycl\w*|rainwater|kl\/?day|kld|mld)s?\b/i;
const INDUSTRIAL_CLUSTERS = /\b(peenya|bommasandra|jigani|electronic city|whitefield|kiadb|attibele|hoskote|doddaballapur|nelamangala|dabaspet|bidadi|harohalli|veerasandra|hebbagodi|mahadevapura)\b/i;

export interface OrgForAssessment {
  id: number;
  name: string;
  org_type: OrgType;
  sector: string | null;
  address: string | null;
  area: string | null;
  lat: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  field_sources: Record<string, FieldSource>;
  intelligence: Intelligence;
}

export function assessOrganization(o: OrgForAssessment): Required<Pick<Intelligence, "potential" | "reasons" | "confidence" | "provenance" | "assessedAt">> {
  const reasons: string[] = [];
  let score = 0;
  let evidence = 0;

  const typeInfo = TYPE_WEIGHT[o.org_type];
  if (typeInfo) {
    score += typeInfo.score;
    evidence += o.field_sources?.org_type?.provenance === "AI Inference" ? 0.5 : 1;
    reasons.push(typeInfo.reason + (o.field_sources?.org_type?.provenance === "AI Inference" ? " (type inferred from name)" : ""));
  }
  if (o.sector && WATER_INTENSIVE_SECTOR.test(o.sector)) {
    score += 1;
    evidence += 1;
    reasons.push(`Sector "${o.sector}" is typically water-intensive`);
  } else if (o.sector) {
    evidence += 0.5;
  }
  const waterInfo: WaterInfo[] = o.intelligence?.waterInfo ?? [];
  const signal = waterInfo.find((w) => WATER_SIGNAL.test(w.text));
  if (signal) {
    score += 1;
    evidence += 1;
    reasons.push(`Recorded water information: "${signal.text}"${signal.source ? ` (source: ${signal.source})` : ""}`);
  }
  const place = `${o.area ?? ""} ${o.address ?? ""}`;
  if (INDUSTRIAL_CLUSTERS.test(place) && (o.org_type === "Manufacturing" || o.org_type === "Industrial")) {
    score += 0.5;
    reasons.push(`Located in an industrial cluster (${place.match(INDUSTRIAL_CLUSTERS)![0]})`);
  }

  let potential: Potential;
  if (!typeInfo && !o.sector && !signal) {
    potential = "Unknown";
    reasons.push("Not enough information on the organization type or activity to assess");
  } else potential = score >= 3 ? "High" : score >= 2 ? "Medium" : "Low";

  // Data confidence: how much verified information the assessment rests on
  const contactable = Boolean(o.phone || o.email);
  const located = o.lat != null;
  const completeness = evidence + (contactable ? 0.5 : 0) + (located ? 0.5 : 0) + (o.address ? 0.5 : 0);
  const confidence: DataConfidence = potential === "Unknown" ? "Unknown" : completeness >= 3 ? "High" : completeness >= 1.75 ? "Medium" : "Low";
  if (!contactable) reasons.push("No phone or email on record yet");

  return { potential, reasons, confidence, provenance: "AI Inference", assessedAt: new Date().toISOString() };
}

export async function assessAndStore(q: Queryable, orgId: number) {
  const { rows } = await q.query<OrgForAssessment>(
    `SELECT id, name, org_type, sector, address, area, ST_Y(geom::geometry) AS lat, phone, email, website, field_sources, intelligence
       FROM organizations WHERE id = $1`,
    [orgId],
  );
  if (!rows[0]) return null;
  const result = assessOrganization(rows[0]);
  await q.query(`UPDATE organizations SET intelligence = intelligence || $2::jsonb WHERE id = $1`, [orgId, JSON.stringify(result)]);
  return result;
}
