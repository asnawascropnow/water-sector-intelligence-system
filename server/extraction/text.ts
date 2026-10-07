import type { OrganizationInput } from "../../shared/types";
import { rowsToRecords } from "./tabular";

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?91[\s-]?)?(?:0?80[\s-]?\d{4}[\s-]?\d{4}|[6-9]\d{4}[\s-]?\d{5}|0\d{2,4}[\s-]?\d{6,8})/;
const WEBSITE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|co\.in|edu|ac\.in|gov\.in|io|biz)(?:\/\S*)?\b/i;
const LABEL = /^(?:[a-z ]{2,20})\s*[:\-–]\s*/i;

/** Tab- or multi-space-separated text → tabular rows. */
function textToGrid(text: string): unknown[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.includes("\t") ? l.split("\t") : l.split(/\s{2,}|\s*\|\s*/)).map((c) => c.trim()));
}

/**
 * Heuristic extraction for unstructured text (PDF/DOCX without tables):
 * blocks separated by blank lines, first line = organization name, remaining lines parsed
 * for labelled fields, phone, email, website; the rest becomes the address.
 */
function blocksToRecords(text: string): OrganizationInput[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length >= 2 && b.length <= 12);
  const out: OrganizationInput[] = [];
  for (const lines of blocks) {
    const name = lines[0].replace(/^\d+[.)]\s*/, "").replace(LABEL, "").trim();
    if (!name || name.length > 120 || EMAIL.test(name)) continue;
    const rec: OrganizationInput = { name };
    const addressParts: string[] = [];
    for (const line of lines.slice(1)) {
      const label = line.match(/^([a-z /]{2,25})\s*[:\-–]\s*(.+)$/i);
      const key = label?.[1].toLowerCase().trim();
      const val = label ? label[2].trim() : line;
      if (key && /sector|industry/.test(key)) rec.sector = val;
      else if (key && /^type|category/.test(key)) rec.org_type = val as OrganizationInput["org_type"];
      else if (key && /contact person|contact name|^contact$|person/.test(key)) rec.contact_name = val;
      else if (key && /designation/.test(key)) rec.contact_designation = val;
      else if (key && /area|locality/.test(key)) rec.area = val;
      else if (key && /pin/.test(key)) rec.pincode = val;
      else if (EMAIL.test(line) && !rec.email) rec.email = line.match(EMAIL)![0];
      else if (PHONE.test(line) && !rec.phone && !/address/.test(key ?? "")) rec.phone = line.match(PHONE)![0];
      else if (WEBSITE.test(line) && !rec.website && !/address/.test(key ?? "")) rec.website = line.match(WEBSITE)![0];
      else addressParts.push(val);
    }
    if (addressParts.length) rec.address = addressParts.join(", ");
    // Needs at least one identifying detail beyond the name to count as an organization entry
    if (rec.address || rec.phone || rec.email || rec.website) out.push(rec);
  }
  return out;
}

export function extractFromText(text: string): { records: OrganizationInput[]; method: string } {
  const grid = textToGrid(text);
  const tabular = rowsToRecords(grid);
  if (tabular && tabular.length) return { records: tabular, method: "text-table" };
  return { records: blocksToRecords(text), method: "text-blocks" };
}
