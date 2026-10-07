import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { extractOrganizations } from "./index";
import { normalizeRecord } from "../lib/normalize";

const here = path.dirname(fileURLToPath(import.meta.url));

test("xlsx: finds the header row below a title and maps synonym columns", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Leads");
  ws.addRow(["Fayaas — Peenya visit, Sept"]);
  ws.addRow([]);
  ws.addRow(["S.No", "Name of the Organisation", "Industry", "Full Address", "Mobile", "E-mail ID", "Contact Person"]);
  ws.addRow([1, "ABC Industries Pvt Ltd", "Textile dyeing", "Plot 12, Peenya 2nd Phase, Bengaluru 560058", "9845012345", "info@abc.in", "R. Kumar"]);
  ws.addRow([2, "XYZ Foods", "Food processing", "Bommasandra Industrial Area", "080 2839 1234", "", ""]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const { records, method } = await extractOrganizations(buf, "xlsx");
  assert.equal(method, "spreadsheet");
  assert.equal(records.length, 2);
  assert.equal(records[0].name, "ABC Industries Pvt Ltd");
  assert.equal(records[0].sector, "Textile dyeing");
  assert.equal(records[0].contact_name, "R. Kumar");
  assert.equal(String(records[1].phone), "080 2839 1234");
});

test("csv: basic columns", async () => {
  const csv = "Company,Address,Phone,Website\nSunrise Hospital,\"Hosur Road, Koramangala 560034\",9845012345,sunrisehosp.in\n";
  const { records } = await extractOrganizations(Buffer.from(csv), "csv");
  assert.equal(records.length, 1);
  assert.equal(records[0].website, "sunrisehosp.in");
});

test("docx: reads tables", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const cell = (t: string) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const row = (...c: string[]) => `<w:tr>${c.map(cell).join("")}</w:tr>`;
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>${row("Organization", "Type", "Address", "Phone")}${row("Green Valley School", "School", "Yelahanka New Town, Bengaluru", "080 2846 0000")}${row("Hotel Lotus", "Hotel", "MG Road, Bengaluru 560001", "9900112233")}</w:tbl></w:body></w:document>`,
  );
  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const { records, method } = await extractOrganizations(buf, "docx");
  assert.equal(method, "document-table");
  assert.deepEqual(
    records.map((r) => r.name),
    ["Green Valley School", "Hotel Lotus"],
  );
});

test("pdf: free-text blocks are parsed into organizations (no AI key)", async () => {
  delete process.env.GEMINI_API_KEY;
  const buf = fs.readFileSync(path.join(here, "fixtures/field-visit-list.pdf"));
  const { records, method } = await extractOrganizations(buf, "pdf");
  assert.match(method, /^text-/);
  const names = records.map((r) => r.name);
  assert.ok(names.some((n) => /Greenfield Textiles/.test(n)), `got ${JSON.stringify(records)}`);
  assert.ok(names.some((n) => /Lakeview/.test(n)), `got ${JSON.stringify(records)}`);
  const g = records.find((r) => /Greenfield/.test(r.name))!;
  assert.equal(g.email, "plant@greenfieldtex.in");
  assert.equal(g.sector, "Textile dyeing");
});

test("normalizeRecord: derives pincode/area, labels inferred type, never invents location", () => {
  const n = normalizeRecord({ name: "Lakeview Multispeciality Hospital", address: "ITPL Main Road, Whitefield, Bengaluru 560066", phone: "+91 98860 11223" }, "test");
  assert.equal(n.data.pincode, "560066");
  assert.equal(n.data.area, "Whitefield");
  assert.equal(n.data.org_type, "Hospital");
  assert.equal(n.field_sources.org_type.provenance, "AI Inference");
  assert.equal(n.data.lat, null);
  assert.equal(n.data.phone, "+91 98860 11223");
});

test("normalizeRecord: swapped coordinates are corrected and flagged", () => {
  const n = normalizeRecord({ name: "X", lat: 77.59, lng: 12.97 }, "test");
  assert.equal(n.data.lat, 12.97);
  assert.ok(n.warnings.some((w) => /swapped/.test(w)));
});
