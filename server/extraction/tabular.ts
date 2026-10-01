import type { OrganizationInput } from "../../shared/types";

type Field = keyof OrganizationInput;

// Header synonyms → organization field. Matching is case/punctuation-insensitive.
const HEADER_SYNONYMS: Record<Field, string[]> = {
  name: ["organization", "organisation", "organization name", "organisation name", "company", "company name", "name", "org name", "institution", "institution name", "establishment", "firm", "business name", "facility", "facility name", "unit name", "industry name", "hospital name", "school name", "hotel name"],
  org_type: ["type", "organization type", "organisation type", "org type", "category", "segment", "facility type", "institution type"],
  sector: ["sector", "industry", "industry type", "business type", "sub category", "subcategory", "nature of business", "activity", "product", "products"],
  address: ["address", "full address", "location address", "street address", "registered address", "office address", "plant address", "factory address", "postal address"],
  area: ["area", "locality", "location", "zone", "ward", "neighbourhood", "neighborhood", "industrial area", "taluk"],
  city: ["city", "town", "district"],
  pincode: ["pincode", "pin code", "pin", "zip", "zip code", "postal code", "postcode"],
  lat: ["lat", "latitude", "y"],
  lng: ["lng", "lon", "long", "longitude", "x"],
  website: ["website", "web", "url", "web site", "site", "homepage", "website url"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "mobile number", "contact number", "contact no", "phone no", "landline", "contact phone"],
  email: ["email", "e mail", "email id", "email address", "mail", "contact email"],
  contact_name: ["contact person", "contact name", "contact", "person", "poc", "point of contact", "key contact", "manager", "owner name"],
  contact_designation: ["designation", "title", "role", "position", "contact designation"],
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function matchHeader(h: unknown): Field | null {
  const n = norm(h);
  if (!n) return null;
  for (const [field, syns] of Object.entries(HEADER_SYNONYMS) as [Field, string[]][]) {
    if (syns.includes(n)) return field;
  }
  // partial match on longer headers ("Name of the Organisation", "Contact Person Mobile")
  if (/mobile|phone|tel/.test(n)) return "phone";
  if (/e ?mail/.test(n)) return "email";
  if (/website|url/.test(n)) return "website";
  if (/pin ?code|postal/.test(n)) return "pincode";
  if (/address/.test(n)) return "address";
  if (/contact person|contact name/.test(n)) return "contact_name";
  if (/(organi[sz]ation|company|institution|establishment|firm|industry) name|name of/.test(n)) return "name";
  return null;
}

/** Find the header row within the first rows of a sheet and map columns to fields. */
export function detectHeader(rows: unknown[][]): { headerIndex: number; mapping: (Field | null)[] } | null {
  let best: { headerIndex: number; mapping: (Field | null)[]; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const mapping = rows[i].map(matchHeader);
    const seen = new Set<Field>();
    // keep first occurrence of each field only
    const deduped = mapping.map((f) => (f && !seen.has(f) ? (seen.add(f), f) : null));
    const score = deduped.filter(Boolean).length + (seen.has("name") ? 2 : 0);
    if (seen.has("name") && score >= 3 && (!best || score > best.score)) best = { headerIndex: i, mapping: deduped, score };
  }
  return best ? { headerIndex: best.headerIndex, mapping: best.mapping } : null;
}

export function rowsToRecords(rows: unknown[][]): OrganizationInput[] | null {
  const header = detectHeader(rows);
  if (!header) return null;
  const out: OrganizationInput[] = [];
  for (const row of rows.slice(header.headerIndex + 1)) {
    const rec: Record<string, unknown> = {};
    header.mapping.forEach((field, col) => {
      if (!field) return;
      const v = row[col];
      if (v !== null && v !== undefined && String(v).trim() !== "") rec[field] = v;
    });
    if (rec.name) out.push(rec as unknown as OrganizationInput);
  }
  return out;
}
