import { CITY, ORG_TYPES, type OrgType } from "../../shared/constants";
import type { FieldSource, OrganizationInput } from "../../shared/types";

const LEGAL_SUFFIXES = [
  "private limited", "pvt ltd", "pvt limited", "private ltd", "pvt", "private", "limited", "ltd",
  "llp", "inc", "incorporated", "corporation", "corp", "co", "company", "and co",
];

/** Canonical form of an organization name for duplicate matching. */
export function normalizeName(name: string): string {
  let s = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\bbangalore\b/g, "bengaluru")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // strip legal suffixes repeatedly ("... pvt ltd", "... private limited")
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of LEGAL_SUFFIXES) {
      if (s.endsWith(" " + suf)) {
        s = s.slice(0, -suf.length - 1).trim();
        changed = true;
      }
    }
  }
  // light stemming so "industry" == "industries", "technology" == "technologies"
  return s
    .split(" ")
    .map((w) => w.replace(/ies$/, "y").replace(/(?<=[a-z]{3})s$/, ""))
    .join(" ");
}

export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s || /^(n\/?a|na|nil|none|null|-+|unknown)$/i.test(s)) return null;
  return s;
}

/** Normalise Indian phone numbers to +91 XXXXX XXXXX (mobile) or +91 80 XXXX XXXX (Bengaluru landline). */
export function normalizePhone(v: unknown): string | null {
  const raw = cleanText(v);
  if (!raw) return null;
  const first = raw.split(/[\/,;]| or /i)[0];
  let digits = first.replace(/\D/g, "");
  // Bengaluru landline when written with STD code: 080…, +91 80 …, (80) …
  const landline = /^\s*(0\s*80|\+?\s*91[\s-]*80[\s-]|\(0?80\))/.test(first);
  if (digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 8) digits = "80" + digits; // Bengaluru landline without STD code
  if (digits.length !== 10) return raw; // keep as-is rather than guess
  if (digits.startsWith("80") && (landline || first.replace(/\D/g, "").length === 8)) return `+91 80 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  if (/^[6-9]/.test(digits)) return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  if (digits.startsWith("80")) return `+91 80 ${digits.slice(2, 6)} ${digits.slice(6)}`;
  return `+91 ${digits}`;
}

export function phoneKey(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export function normalizeWebsite(v: unknown): string | null {
  const raw = cleanText(v);
  if (!raw || raw.includes(" ") || !raw.includes(".")) return null;
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return null;
  }
}

export function websiteDomain(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeEmail(v: unknown): string | null {
  const raw = cleanText(v);
  if (!raw) return null;
  const m = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

const FREE_EMAIL = new Set(["gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "rediffmail.com", "live.com", "icloud.com"]);
export function corporateEmailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const d = email.split("@")[1]?.toLowerCase();
  return d && !FREE_EMAIL.has(d) ? d : null;
}

export function extractPincode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\b(5[6-9]\d)\s?(\d{3})\b/);
  return m ? m[1] + m[2] : null;
}

// Known Bengaluru localities, used to derive "Area" from free-text addresses.
export const BENGALURU_AREAS = [
  "Peenya", "Whitefield", "Electronic City", "Bommasandra", "Jigani", "Attibele", "Anekal", "Hosur Road",
  "Koramangala", "Indiranagar", "Jayanagar", "JP Nagar", "BTM Layout", "HSR Layout", "Banashankari",
  "Basavanagudi", "Malleshwaram", "Rajajinagar", "Yeshwanthpur", "Hebbal", "Yelahanka", "Jakkur",
  "Thanisandra", "Hennur", "Banaswadi", "KR Puram", "Mahadevapura", "Marathahalli", "Bellandur",
  "Sarjapur", "Varthur", "Brookefield", "Kadugodi", "Hoskote", "Devanahalli", "Doddaballapur",
  "Nelamangala", "Dabaspet", "Bidadi", "Kengeri", "Rajarajeshwari Nagar", "Vijayanagar", "Nagarbhavi",
  "Mysore Road", "Kanakapura Road", "Bannerghatta Road", "Tumkur Road", "Old Madras Road", "Old Airport Road",
  "MG Road", "Brigade Road", "Residency Road", "Richmond Town", "Shivajinagar", "Frazer Town",
  "Cox Town", "Ulsoor", "Domlur", "Sadashivanagar", "Vasanth Nagar", "Seshadripuram", "Majestic",
  "Gandhinagar", "Chamarajpet", "Wilson Garden", "Lalbagh", "Bommanahalli", "Begur", "Hulimavu",
  "Kumaraswamy Layout", "Uttarahalli", "Jalahalli", "Mathikere", "RT Nagar", "Sanjaynagar",
  "Kammanahalli", "Horamavu", "Ramamurthy Nagar", "CV Raman Nagar", "HAL", "Bagalur", "Hoodi",
  "Kundalahalli", "Mahalakshmi Layout", "Basaveshwaranagar", "Dasarahalli", "Chikkabanavara",
  "Yelahanka New Town", "Sahakar Nagar", "Vidyaranyapura", "Hesaraghatta", "Kumbalgodu", "Harohalli",
  "Bommasandra Industrial Area", "Veerasandra", "Hebbagodi", "Chandapura", "Kalyan Nagar", "Nagawara",
  "Manyata", "Palace Road", "Cunningham Road", "Race Course Road", "Lavelle Road", "Vittal Mallya Road",
];
const AREA_ALIASES: Record<string, string> = {
  "rr nagar": "Rajarajeshwari Nagar",
  "k r puram": "KR Puram",
  "j p nagar": "JP Nagar",
  "btm": "BTM Layout",
  "hsr": "HSR Layout",
  "ecity": "Electronic City",
  "e-city": "Electronic City",
  "indira nagar": "Indiranagar",
  "malleswaram": "Malleshwaram",
  "yeshwantpur": "Yeshwanthpur",
  "yeshwanthapura": "Yeshwanthpur",
};

export function extractArea(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  for (const [alias, area] of Object.entries(AREA_ALIASES)) {
    if (t.includes(` ${alias} `)) return area;
  }
  // prefer longest match ("Yelahanka New Town" over "Yelahanka")
  const matches = BENGALURU_AREAS.filter((a) => t.includes(` ${a.toLowerCase()} `)).sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}

const TYPE_KEYWORDS: [OrgType, RegExp][] = [
  ["Hospital", /\b(hospital|hospitals|clinic|medical cent(er|re)|healthcare|nursing home|diagnostic)\b/i],
  ["College / University", /\b(university|college|institute of technology|engineering college|iit|iisc|iim|polytechnic)\b/i],
  ["School", /\b(school|vidyalaya|academy|high school|public school|kindergarten)\b/i],
  ["Hotel", /\b(hotel|resort|inn|suites|residency hotel|lodge)\b/i],
  ["Apartment", /\b(apartment|apartments|residency|enclave|towers|heights|gated community|layout owners|rwa|residents)\b/i],
  ["IT / Technology", /\b(technolog(y|ies)|software|infotech|it park|tech park|data cent(er|re)|systems|solutions|labs|digital)\b/i],
  ["Manufacturing", /\b(manufactur\w*|industries|industry|factory|mills|textiles?|garments?|pharma\w*|chemicals?|foods?|beverages?|brewer(y|ies)|engineering works|auto(motive)? components?|castings?|forgings?|plastics?|steel|polymers?)\b/i],
  ["Industrial", /\b(industrial|kiadb|estate|warehouse|logistics)\b/i],
  ["Government", /\b(government|govt|bbmp|bwssb|bda|municipal|department|ministry|corporation of|police|court|secretariat|soudha)\b/i],
  ["Commercial", /\b(mall|shopping|market|commercial|business park|plaza|complex|office)\b/i],
  ["Institution", /\b(trust|foundation|society|association|ngo|research|temple|church|mosque|ashram)\b/i],
];

export function inferOrgType(name: string, sector?: string | null): OrgType | null {
  const text = `${name} ${sector ?? ""}`;
  for (const [type, re] of TYPE_KEYWORDS) if (re.test(text)) return type;
  return null;
}

/** Match a free-text type label (from a spreadsheet) to one of the supported types. */
export function matchOrgType(v: unknown): OrgType | null {
  const raw = cleanText(v);
  if (!raw) return null;
  const exact = ORG_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const l = raw.toLowerCase();
  if (/\bit\b|tech|software|office|data cent/.test(l)) return "IT / Technology";
  if (/manufactur|factory|plant/.test(l)) return "Manufacturing";
  if (/industr/.test(l)) return "Industrial";
  if (/hospital|clinic|health/.test(l)) return "Hospital";
  if (/hotel|resort|hospitality/.test(l)) return "Hotel";
  if (/school/.test(l)) return "School";
  if (/college|university|education/.test(l)) return "College / University";
  if (/apartment|residential|housing|rwa/.test(l)) return "Apartment";
  if (/commercial|retail|mall/.test(l)) return "Commercial";
  if (/govt|government|public sector|psu/.test(l)) return "Government";
  if (/institution|trust|ngo|research/.test(l)) return "Institution";
  return inferOrgType(raw);
}

export function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

export function inBengaluru(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (lat == null || lng == null) return false;
  const b = CITY.bounds;
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}

export interface NormalizedRecord {
  data: OrganizationInput;
  field_sources: Record<string, FieldSource>;
  warnings: string[];
}

/**
 * Normalise a raw organization record. Never invents values: anything derived rather than
 * read directly from the source is labelled (AI Inference / Estimated) in field_sources.
 */
export function normalizeRecord(input: OrganizationInput, sourceLabel: string): NormalizedRecord {
  const warnings: string[] = [];
  const fs: Record<string, FieldSource> = {};
  const name = cleanText(input.name) ?? "";
  if (!name) warnings.push("Missing organization name");

  const address = cleanText(input.address);
  const sector = cleanText(input.sector);
  let org_type = matchOrgType(input.org_type);
  if (org_type) fs.org_type = { provenance: "Unverified", source: sourceLabel };
  else {
    const inferred = inferOrgType(name, sector);
    org_type = inferred ?? "Other";
    fs.org_type = inferred
      ? { provenance: "AI Inference", source: "Inferred from organization name/sector" }
      : { provenance: "Unknown", source: null };
  }

  let pincode = cleanText(input.pincode)?.replace(/\s/g, "") ?? null;
  if (pincode && !/^\d{6}$/.test(pincode)) {
    warnings.push(`Invalid pincode "${pincode}" ignored`);
    pincode = null;
  }
  if (!pincode) {
    const fromAddr = extractPincode(address);
    if (fromAddr) {
      pincode = fromAddr;
      fs.pincode = { provenance: "Unverified", source: "Parsed from address" };
    }
  }

  let area = cleanText(input.area);
  if (!area) {
    const fromAddr = extractArea(address);
    if (fromAddr) {
      area = fromAddr;
      fs.area = { provenance: "Unverified", source: "Parsed from address" };
    }
  }

  let lat = toNumber(input.lat);
  let lng = toNumber(input.lng);
  if (lat != null && lng != null) {
    // Common spreadsheet mistake: swapped columns
    if (!inBengaluru(lat, lng) && inBengaluru(lng, lat)) {
      [lat, lng] = [lng, lat];
      warnings.push("Latitude/longitude looked swapped and were corrected");
    }
    if (!inBengaluru(lat, lng)) warnings.push("Coordinates are outside the Bengaluru area");
    fs.location = { provenance: "Unverified", source: sourceLabel };
  } else {
    lat = null;
    lng = null;
  }

  const city = cleanText(input.city) ?? CITY.name;
  if (!/beng|bang/i.test(city)) warnings.push(`City is "${city}" — this MVP covers Bengaluru only`);
  if (pincode && !pincode.startsWith("56")) warnings.push(`Pincode ${pincode} is not a Bengaluru pincode`);

  const website = normalizeWebsite(input.website);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  for (const [k, v] of Object.entries({ website, email, phone, address, sector, name })) {
    if (v && !fs[k]) fs[k] = { provenance: "Unverified", source: sourceLabel };
  }

  return {
    data: {
      name,
      org_type,
      sector,
      address,
      area,
      city: /beng|bang/i.test(city) ? CITY.name : city,
      pincode,
      lat,
      lng,
      website,
      phone,
      email,
      contact_name: cleanText(input.contact_name),
      contact_designation: cleanText(input.contact_designation),
    },
    field_sources: fs,
    warnings,
  };
}

/** Rough data-confidence grade based on completeness of the record. */
export function gradeConfidence(d: OrganizationInput, fs: Record<string, FieldSource>): "High" | "Medium" | "Low" {
  let score = 0;
  if (d.org_type && d.org_type !== "Other" && fs.org_type?.provenance !== "AI Inference") score += 1;
  if (d.address) score += 1;
  if (d.lat != null && fs.location?.provenance !== "Estimated") score += 1;
  if (d.phone || d.email) score += 1;
  if (d.website) score += 1;
  if (d.sector) score += 0.5;
  return score >= 4.5 ? "High" : score >= 2.5 ? "Medium" : "Low";
}
