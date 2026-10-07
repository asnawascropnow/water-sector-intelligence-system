import path from "node:path";
import type { OrganizationInput } from "../../shared/types";
import { rowsToRecords } from "./tabular";
import { extractFromText } from "./text";
import { llmEnabled, llmExtractOrganizations } from "./llm";

export type FileKind = "xlsx" | "csv" | "pdf" | "docx";

export function detectFileKind(filename: string): FileKind | null {
  const ext = path.extname(filename).toLowerCase().slice(1);
  if (ext === "xlsx" || ext === "csv" || ext === "pdf" || ext === "docx") return ext;
  return null;
}

export interface ExtractionResult {
  records: OrganizationInput[];
  method: string;
  notes: string[];
}

function cellValue(v: unknown): unknown {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("text" in o) return o.text; // hyperlink
    if ("result" in o) return o.result; // formula
    if ("richText" in o) return (o.richText as { text: string }[]).map((t) => t.text).join("");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return v;
}

async function extractXlsx(buf: Buffer): Promise<ExtractionResult> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const records: OrganizationInput[] = [];
  const notes: string[] = [];
  wb.eachSheet((sheet) => {
    const rows: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const vals = row.values as unknown[]; // 1-based
      rows.push(vals.slice(1).map(cellValue));
    });
    const recs = rowsToRecords(rows);
    if (recs?.length) {
      records.push(...recs);
      notes.push(`Sheet "${sheet.name}": ${recs.length} rows`);
    } else if (rows.length) notes.push(`Sheet "${sheet.name}": no organization-name column found — skipped`);
  });
  return { records, method: "spreadsheet", notes };
}

async function extractCsv(buf: Buffer): Promise<ExtractionResult> {
  const Papa = (await import("papaparse")).default;
  const parsed = Papa.parse<unknown[]>(buf.toString("utf8").replace(/^﻿/, ""), { skipEmptyLines: true });
  const recs = rowsToRecords(parsed.data);
  if (!recs) return { records: [], method: "spreadsheet", notes: ["No organization-name column found in the CSV header"] };
  return { records: recs, method: "spreadsheet", notes: [] };
}

async function extractDocx(buf: Buffer): Promise<ExtractionResult> {
  const mammoth = (await import("mammoth")).default;
  const notes: string[] = [];
  // Tables first: convert to HTML and read <table> rows.
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const tables = [...html.matchAll(/<table>([\s\S]*?)<\/table>/g)].map((t) =>
    [...t[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
      [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
        c[1].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
      ),
    ),
  );
  const fromTables = tables.flatMap((t) => rowsToRecords(t) ?? []);
  if (fromTables.length) return { records: fromTables, method: "document-table", notes: [`${tables.length} table(s) read`] };
  const { value: text } = await mammoth.extractRawText({ buffer: buf });
  return extractUnstructured(text, notes);
}

/**
 * Rebuild PDF text line by line from item positions, inserting a blank line where the vertical
 * gap is clearly larger than normal line spacing — so separate entries become separate blocks.
 */
async function extractPdf(buf: Buffer): Promise<ExtractionResult> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of content.items as { str: string; transform: number[] }[]) {
      if (!("str" in it) || !it.str.trim()) continue;
      const y = it.transform[5];
      const line = lines.find((l) => Math.abs(l.y - y) < 2);
      if (line) line.parts.push({ x: it.transform[4], s: it.str });
      else lines.push({ y, parts: [{ x: it.transform[4], s: it.str }] });
    }
    lines.sort((a, b) => b.y - a.y);
    const gaps = lines.slice(1).map((l, i) => lines[i].y - l.y).sort((a, b) => a - b);
    const typical = gaps.length ? gaps[Math.floor(gaps.length / 4)] : 0;
    let out = "";
    lines.forEach((l, i) => {
      const text = l.parts.sort((a, b) => a.x - b.x).map((x) => x.s).join("\t");
      if (i > 0) out += lines[i - 1].y - l.y > typical * 1.6 ? "\n\n" : "\n";
      out += text;
    });
    pages.push(out);
  }
  const text = pages.join("\n\n");
  if (!text.trim()) return { records: [], method: "pdf", notes: ["No text layer found — scanned PDFs need OCR, which is not supported yet"] };
  return extractUnstructured(text, []);
}

async function extractUnstructured(text: string, notes: string[]): Promise<ExtractionResult> {
  if (llmEnabled()) {
    try {
      const recs = await llmExtractOrganizations(text);
      if (recs && recs.length) return { records: recs, method: "ai-extraction", notes: [...notes, "Extracted by the AI extraction agent — review carefully"] };
    } catch (e) {
      notes.push(`AI extraction failed (${(e as Error).message}); fell back to rule-based parsing`);
    }
  }
  const { records, method } = extractFromText(text);
  if (method === "text-blocks") notes.push("Parsed from free text — lower confidence, review each record");
  return { records, method, notes };
}

export async function extractOrganizations(buf: Buffer, kind: FileKind): Promise<ExtractionResult> {
  switch (kind) {
    case "xlsx":
      return extractXlsx(buf);
    case "csv":
      return extractCsv(buf);
    case "docx":
      return extractDocx(buf);
    case "pdf":
      return extractPdf(buf);
  }
}
