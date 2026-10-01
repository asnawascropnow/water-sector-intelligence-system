import type { OrganizationInput } from "../../shared/types";

export const llmEnabled = () => Boolean(process.env.GEMINI_API_KEY);
export const llmModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

async function client() {
  const { GoogleGenAI } = await import("@google/genai");
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
}

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const m = cleaned.match(/[\[{][\s\S]*[\]}]/);
    try {
      return m ? (JSON.parse(m[0]) as T) : null;
    } catch {
      return null;
    }
  }
}

/**
 * LLM-assisted extraction for unstructured documents (optional; needs GEMINI_API_KEY).
 * The model is instructed to copy values verbatim and leave unknown fields null.
 */
export async function llmExtractOrganizations(text: string): Promise<OrganizationInput[] | null> {
  if (!llmEnabled()) return null;
  const ai = await client();
  const prompt = `Extract every organization (company, hospital, school, hotel, apartment, institution, office…) listed in the document below.
Return ONLY a JSON array. Each item: {"name","org_type","sector","address","area","city","pincode","website","phone","email","contact_name","contact_designation"}.
Rules: copy values exactly as written in the document; use null for anything not present; never guess or invent values; do not include people as organizations.

DOCUMENT:
${text.slice(0, 60000)}`;
  const res = await ai.models.generateContent({
    model: llmModel(),
    contents: prompt,
    config: { responseMimeType: "application/json", temperature: 0 },
  });
  const arr = parseJson<OrganizationInput[]>(res.text);
  return Array.isArray(arr) ? arr.filter((r) => r && typeof r.name === "string" && r.name.trim()) : null;
}

export interface WebFinding {
  field: "website" | "phone" | "email" | "sector" | "org_type" | "address" | "water_info";
  value: string;
  source: string;
}

/**
 * Web-grounded enrichment (optional). Uses Google Search grounding; every finding must carry a source URL.
 */
export async function llmResearchOrganization(org: { name: string; address: string | null; area: string | null }): Promise<WebFinding[]> {
  if (!llmEnabled()) return [];
  const ai = await client();
  const prompt = `Research this organization in Bengaluru, India using web search:
Name: ${org.name}
Address: ${org.address ?? "unknown"}
Area: ${org.area ?? "unknown"}

Return ONLY a JSON array of findings: [{"field": one of "website"|"phone"|"email"|"sector"|"org_type"|"address"|"water_info", "value": string, "source": the exact URL the value came from}].
"water_info" = publicly stated water-related facts (e.g. STP, ZLD, borewell use, rainwater harvesting, water consumption) — only if explicitly published.
Only include facts you found on a specific web page. If nothing is found, return [].`;
  const res = await ai.models.generateContent({
    model: llmModel(),
    contents: prompt,
    config: { tools: [{ googleSearch: {} }], temperature: 0 },
  });
  const arr = parseJson<WebFinding[]>(res.text) ?? [];
  return arr.filter((f) => f && f.value && typeof f.source === "string" && /^https?:\/\//.test(f.source));
}
