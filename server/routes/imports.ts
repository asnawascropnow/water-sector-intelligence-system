import { Router } from "express";
import multer from "multer";
import { db, type Queryable } from "../db";
import type { FieldSource, ImportRecord, OrganizationInput, ProjectInput } from "../../shared/types";
import { actorId, ah, HttpError, intParam } from "../lib/http";
import { createSource } from "../lib/log";
import { findDuplicates } from "../lib/duplicates";
import { geocodeAddress, geocoderEnabled } from "../lib/geocode";
import { normalizeName, normalizeRecord } from "../lib/normalize";
import { insertOrganization, mergeIntoOrganization } from "../lib/organizations";
import { createProject, normalizeProject } from "../lib/projects";
import { findProjectDuplicates } from "../lib/projectDuplicates";
import { detectFileKind, extractOrganizations, type ExtractionResult } from "../extraction";

export const importsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const SUMMARY_SELECT = `
  SELECT i.id, i.filename, i.file_type, i.kind, i.status, i.extraction_method, i.error, i.created_at, i.completed_at, u.name AS uploaded_by_name,
         json_build_object(
           'found', jsonb_array_length(i.records),
           'new', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->'duplicate'->>'level' = 'new'),
           'existing', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->'duplicate'->>'level' = 'existing'),
           'possible_duplicates', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->'duplicate'->>'level' = 'possible_duplicate'),
           'pending', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->>'status' = 'pending'),
           'approved', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->>'status' = 'approved'),
           'merged', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->>'status' = 'merged'),
           'rejected', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->>'status' = 'rejected'),
           'organizations', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE coalesce(r->>'entity_type', 'organization') = 'organization'),
           'projects', (SELECT count(*)::int FROM jsonb_array_elements(i.records) r WHERE r->>'entity_type' = 'project')
         ) AS stats
    FROM imports i LEFT JOIN users u ON u.id = i.uploaded_by`;

/**
 * Stage a project record (WSIS Phase 4 import foundation): validated with the same rules as the projects
 * API and checked against existing projects. Invalid records are staged with the problem as a warning so a
 * person can fix them with "edit"; nothing is saved before review. Project records are not geocoded yet.
 */
async function stageProject(q: Queryable, raw: ProjectInput, sourceLabel: string, index: number, seen: Map<string, number>): Promise<ImportRecord> {
  const warnings: string[] = [];
  let data: ProjectInput = { ...raw };
  let fieldSources: Record<string, FieldSource> = {};
  try {
    const n = await normalizeProject(q, raw, sourceLabel);
    data = n.data;
    fieldSources = n.fieldSources;
  } catch (e) {
    warnings.push(`Needs a fix before approval: ${(e as Error).message}`);
  }
  delete (data as { entity_type?: string }).entity_type;
  if (data.lat == null) warnings.push("Location unknown — the project will not appear on the map until a location is set");
  const duplicate = data.name ? await findProjectDuplicates(q, data) : { level: "new" as const, candidates: [] };
  const key = `project:${normalizeName(data.name ?? "")}`;
  if (seen.has(key)) {
    warnings.push(`Same project name as record #${seen.get(key)! + 1} in this file`);
    if (duplicate.level === "new") duplicate.level = "possible_duplicate";
  } else seen.set(key, index);
  return {
    index,
    entity_type: "project",
    data: data as unknown as OrganizationInput,
    field_sources: fieldSources,
    warnings,
    duplicate,
    status: "pending",
    result_org_id: null,
    result_project_id: null,
  };
}

/** Agent 1 — Data Extraction Agent: document → organizations → normalise → geocode → duplicate check → staged records. */
async function processImport(importId: number, sourceLabel: string, extract: () => Promise<ExtractionResult>) {
  const q = db();
  try {
    const { records: raw, method, notes } = await extract();
    const staged: ImportRecord[] = [];
    const seenInFile = new Map<string, number>();
    for (const [i, r] of raw.entries()) {
      if ((r as { entity_type?: string }).entity_type === "project") {
        staged.push(await stageProject(q, r as unknown as ProjectInput, sourceLabel, staged.length, seenInFile));
        continue;
      }
      const norm = normalizeRecord(r, sourceLabel);
      if (!norm.data.name) continue;
      if (norm.data.lat == null && geocoderEnabled() && (norm.data.address || norm.data.area)) {
        const hit = await geocodeAddress(norm.data);
        if (hit) {
          norm.data.lat = hit.lat;
          norm.data.lng = hit.lng;
          norm.field_sources.location = { provenance: "Estimated", source: `OpenStreetMap Nominatim, geocoded to ${hit.precision} precision` };
          if (hit.precision !== "address") norm.warnings.push(`Location estimated at ${hit.precision} precision — verify on the map`);
        } else norm.warnings.push("Location unknown — address could not be geocoded; the organization will not appear on the map until a location is set");
      } else if (norm.data.lat == null) norm.warnings.push("Location unknown — no address or coordinates");
      const duplicate = await findDuplicates(q, norm.data);
      const key = normalizeName(norm.data.name);
      if (seenInFile.has(key)) {
        norm.warnings.push(`Same name as record #${seenInFile.get(key)! + 1} in this file`);
        if (duplicate.level === "new") duplicate.level = "possible_duplicate";
      } else seenInFile.set(key, staged.length);
      staged.push({ index: staged.length, entity_type: "organization", data: norm.data, field_sources: norm.field_sources, warnings: norm.warnings, duplicate, status: "pending", result_org_id: null });
      if (i % 25 === 24) await q.query(`UPDATE imports SET records = $2 WHERE id = $1`, [importId, JSON.stringify(staged)]);
    }
    const nProjects = staged.filter((r) => r.entity_type === "project").length;
    const kind = nProjects === 0 ? "organizations" : nProjects === staged.length ? "projects" : "mixed";
    await q.query(`UPDATE imports SET status = $2, records = $3, extraction_method = $4, error = $5, kind = $6 WHERE id = $1`, [
      importId,
      staged.length ? "review" : "failed",
      JSON.stringify(staged),
      method,
      staged.length ? (notes.length ? notes.join("; ") : null) : ["No organizations could be identified in this file.", ...notes].join(" "),
      kind,
    ]);
  } catch (e) {
    await q.query(`UPDATE imports SET status = 'failed', error = $2 WHERE id = $1`, [importId, (e as Error).message]);
  }
}

importsRouter.get(
  "/",
  ah(async (_req, res) => {
    res.json((await db().query(`${SUMMARY_SELECT} ORDER BY i.created_at DESC LIMIT 100`)).rows);
  }),
);

importsRouter.get(
  "/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const { rows } = await db().query(`${SUMMARY_SELECT.replace("SELECT i.id,", "SELECT i.records, i.id,")} WHERE i.id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, "Import not found");
    res.json(rows[0]);
  }),
);

importsRouter.post(
  "/",
  upload.single("file"),
  ah(async (req, res) => {
    const file = req.file;
    if (!file) throw new HttpError(400, "No file uploaded");
    const kind = detectFileKind(file.originalname);
    if (!kind) throw new HttpError(400, "Unsupported file type. Upload Excel (.xlsx), CSV, PDF or Word (.docx).");
    const actor = actorId(req);
    const { rows: u } = await db().query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [actor]);
    const label = `File “${file.originalname}” uploaded by ${u[0]?.name ?? "unknown user"}`;
    const { rows } = await db().query<{ id: number }>(`INSERT INTO imports (filename, file_type, uploaded_by) VALUES ($1, $2, $3) RETURNING id`, [file.originalname, kind, actor]);
    const importId = rows[0].id;
    const sourceId = await createSource(db(), { kind: "file_upload", label, importId, createdBy: actor });
    await db().query(`UPDATE imports SET source_id = $2 WHERE id = $1`, [importId, sourceId]);
    void processImport(importId, label, () => extractOrganizations(file.buffer, kind));
    res.status(202).json({ id: importId });
  }),
);

/** API / data-feed ingestion: same review pipeline as file uploads. */
importsRouter.post(
  "/json",
  ah(async (req, res) => {
    // Records are organizations by default; a record with entity_type "project" is staged as a project.
    const { records, source_label } = req.body as { records: (OrganizationInput & { entity_type?: string })[]; source_label?: string };
    if (!Array.isArray(records) || !records.length) throw new HttpError(400, "records must be a non-empty array");
    const badType = records.find((r) => r.entity_type !== undefined && r.entity_type !== "organization" && r.entity_type !== "project");
    if (badType) throw new HttpError(400, `entity_type must be "organization" or "project"`);
    const actor = actorId(req);
    const label = source_label?.trim() || "API data feed";
    const { rows } = await db().query<{ id: number }>(`INSERT INTO imports (filename, file_type, uploaded_by) VALUES ($1, 'api', $2) RETURNING id`, [label, actor]);
    const sourceId = await createSource(db(), { kind: "api", label, importId: rows[0].id, createdBy: actor });
    await db().query(`UPDATE imports SET source_id = $2 WHERE id = $1`, [rows[0].id, sourceId]);
    void processImport(rows[0].id, label, async () => ({ records, method: "api", notes: [] }));
    res.status(202).json({ id: rows[0].id });
  }),
);

type Decision = "approve" | "keep_separate" | "merge" | "reject" | "edit";

/** Review decisions for staged project records. */
async function decideProject(
  q: Queryable,
  imp: { source_id: number; filename: string },
  rec: ImportRecord,
  decision: Decision,
  body: { data?: ProjectInput },
  actor: number | null,
  who: string,
) {
  const current = rec.data as unknown as ProjectInput;
  if (decision === "edit") {
    if (!body.data) throw new HttpError(400, "data is required");
    const n = await normalizeProject(q, { ...current, ...body.data }, `${imp.filename} (edited by ${who})`);
    rec.data = n.data as unknown as OrganizationInput;
    rec.field_sources = { ...rec.field_sources, ...n.fieldSources };
    rec.warnings = n.data.lat == null ? ["Location unknown — the project will not appear on the map until a location is set"] : [];
    rec.duplicate = await findProjectDuplicates(q, n.data);
    return;
  }
  if (decision === "reject") {
    rec.status = "rejected";
    return;
  }
  if (decision === "merge") throw new HttpError(400, "Merging an imported project into an existing project is not supported yet. Approve it as a separate project, edit it, or reject it.");
  if (decision === "approve") {
    const fresh = await findProjectDuplicates(q, current);
    if (fresh.level !== "new") {
      rec.duplicate = fresh;
      throw new HttpError(409, "Possible duplicate project found", { duplicate: fresh, record: rec });
    }
  }
  const project = await createProject(q, current, { sourceId: imp.source_id, sourceLabel: `Import “${imp.filename}” (approved by ${who})`, actorId: actor });
  rec.result_project_id = project.id;
  rec.status = "approved";
}

async function applyDecision(importId: number, index: number, decision: Decision, body: { data?: OrganizationInput; merge_into?: number }, actor: number | null) {
  return db().tx(async (q) => {
    const { rows } = await q.query<{ records: ImportRecord[]; status: string; source_id: number; filename: string }>(
      `SELECT records, status, source_id, filename FROM imports WHERE id = $1`,
      [importId],
    );
    const imp = rows[0];
    if (!imp) throw new HttpError(404, "Import not found");
    const rec = imp.records[index];
    if (!rec) throw new HttpError(404, "Record not found");
    if (rec.status !== "pending") throw new HttpError(409, `Record already ${rec.status}`);
    const { rows: u } = await q.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [actor]);
    const who = u[0]?.name ?? "unknown user";

    if (rec.entity_type === "project") {
      await decideProject(q, imp, rec, decision, body as { data?: ProjectInput }, actor, who);
    } else if (decision === "edit") {
      if (!body.data) throw new HttpError(400, "data is required");
      const norm = normalizeRecord(body.data, `${imp.filename} (edited by ${who})`);
      if (!norm.data.name) throw new HttpError(400, "Organization name is required");
      if (norm.data.lat == null && rec.data.lat != null && body.data.lat === undefined) {
        norm.data.lat = rec.data.lat;
        norm.data.lng = rec.data.lng;
        if (rec.field_sources.location) norm.field_sources.location = rec.field_sources.location;
      }
      rec.data = norm.data;
      rec.field_sources = { ...rec.field_sources, ...norm.field_sources };
      rec.warnings = norm.warnings;
      rec.duplicate = await findDuplicates(q, norm.data);
    } else if (decision === "reject") {
      rec.status = "rejected";
    } else if (decision === "merge") {
      const target = body.merge_into ?? rec.duplicate.candidates[0]?.id ?? (await findDuplicates(q, rec.data)).candidates[0]?.id;
      if (!target) throw new HttpError(400, "No organization to merge into");
      await mergeIntoOrganization(q, target, rec.data, { fieldSources: rec.field_sources, sourceId: imp.source_id, actorId: actor, sourceLabel: `import “${imp.filename}”` });
      rec.status = "merged";
      rec.result_org_id = target;
    } else {
      // approve / keep_separate — re-check duplicates now, since earlier approvals may have created matches
      if (decision === "approve") {
        const fresh = await findDuplicates(q, rec.data);
        if (fresh.level !== "new") {
          rec.duplicate = fresh;
          await q.query(`UPDATE imports SET records = $2 WHERE id = $1`, [importId, JSON.stringify(imp.records)]);
          throw new HttpError(409, "Possible duplicate found", { duplicate: fresh, record: rec });
        }
      }
      rec.result_org_id = await insertOrganization(q, rec.data, {
        fieldSources: rec.field_sources,
        sourceId: imp.source_id,
        actorId: actor,
        activitySummary: `Organization added from import “${imp.filename}” (approved by ${who})`,
        importId,
      });
      rec.status = "approved";
    }
    const pending = imp.records.some((r) => r.status === "pending");
    await q.query(`UPDATE imports SET records = $2, status = $3, completed_at = CASE WHEN $3 = 'completed' THEN now() ELSE completed_at END WHERE id = $1`, [
      importId,
      JSON.stringify(imp.records),
      pending ? "review" : "completed",
    ]);
    return rec;
  });
}

importsRouter.post(
  "/:id/records/:index/:decision",
  ah(async (req, res) => {
    const decision = req.params.decision as Decision;
    if (!["approve", "keep_separate", "merge", "reject", "edit"].includes(decision)) throw new HttpError(400, "Unknown decision");
    const rec = await applyDecision(intParam(req.params.id), Number(req.params.index), decision, req.body ?? {}, actorId(req));
    res.json(rec);
  }),
);

/** Approve every pending record that the duplicate check classified as new. Uncertain records stay for review. */
importsRouter.post(
  "/:id/approve-new",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const { rows } = await db().query<{ records: ImportRecord[] }>(`SELECT records FROM imports WHERE id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, "Import not found");
    let approved = 0;
    let held = 0;
    for (const r of rows[0].records) {
      if (r.status !== "pending" || r.duplicate.level !== "new" || r.warnings.some((w) => /same name as record/i.test(w))) continue;
      try {
        await applyDecision(id, r.index, "approve", {}, actorId(req));
        approved++;
      } catch (e) {
        if (e instanceof HttpError && e.status === 409) held++;
        else throw e;
      }
    }
    res.json({ approved, held });
  }),
);
