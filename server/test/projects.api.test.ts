import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { startTestApi, waitForImport, type TestApi } from "./helpers";

// WSIS Phase 4: projects API, stakeholders, project facts, organization ↔ project data, CRM with projects,
// and the import model distinguishing organization / project records.

let api: TestApi;
const ids: Record<string, number> = {};
const FAYAAS = 1;
const AKASH = 2;

before(async () => {
  api = await startTestApi();
  const org = async (key: string, name: string, org_type: string) => {
    const r = await api.call("POST", "/organizations", { data: { name, org_type }, force: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[key] = r.body.id;
  };
  await org("architect", "Mistry Architects", "Architect");
  await org("developer", "Brigade Enterprises", "Real Estate Developer");
  await org("contractor", "Shapoorji Civil Works", "Civil Contractor");
  await org("mep", "Spectral MEP Consultants", "MEP Consultant");
  await org("hospital", "Lakeview Hospital", "Hospital");
});
after(() => api.close());

const lakeside = {
  name: "Brigade Lakeside Phase 1",
  project_type: "Residential",
  description: "640-unit apartment project",
  address: "Off Hennur Road, Thanisandra, Bengaluru 560077",
  lat: 13.0601,
  lng: 77.6312,
  website: "brigadelakeside.in",
  lifecycle_stage: "Construction",
  built_up_area_sqft: 850000,
  building_count: 6,
  unit_count: 640,
  scale: "Large",
};

/* ---------------- Projects ---------------- */

test("create project: all schema fields, normalisation, provenance, audit", async () => {
  const r = await api.call("POST", "/projects", { data: lakeside });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = r.body;
  ids.lakeside = p.id;
  assert.equal(p.name, "Brigade Lakeside Phase 1");
  assert.equal(p.project_type, "Residential");
  assert.equal(p.lifecycle_stage, "Construction");
  assert.equal(p.scale, "Large");
  assert.equal(p.unit_count, 640);
  assert.equal(p.building_count, 6);
  assert.equal(Number(p.built_up_area_sqft), 850000);
  assert.equal(p.website, "https://brigadelakeside.in");
  assert.equal(p.pincode, "560077");
  assert.equal(p.area, "Thanisandra");
  assert.ok(Math.abs(p.lat - 13.0601) < 1e-6 && Math.abs(p.lng - 77.6312) < 1e-6);
  assert.equal(p.city, "Bengaluru");
  assert.equal(p.field_sources.unit_count.provenance, "Unverified");
  assert.match(p.field_sources.unit_count.source, /Manual entry by Fayaas/);
  assert.deepEqual(p.field_sources.pincode, { provenance: "Unverified", source: "Parsed from address" });
  assert.match(p.source_label, /Manual entry by Fayaas/);
  assert.equal(p.created_by_name, "Fayaas");
  assert.deepEqual(p.intelligence, {});
  assert.equal(p.merged_into, null);
  assert.ok(p.created_at && p.updated_at);
  const norm = await db().query(`SELECT normalized_name FROM projects WHERE id = $1`, [p.id]);
  assert.equal(norm.rows[0].normalized_name, "brigade lakeside phase 1");
  const aud = await db().query(`SELECT 1 FROM audit_logs WHERE entity = 'project' AND entity_id = $1 AND action = 'create'`, [p.id]);
  assert.equal(aud.rows.length, 1);
  // Unknown values stay unknown.
  const bare = (await api.call("POST", "/projects", { data: { name: "Hebbal Lake Tech Park" } })).body;
  ids.techpark = bare.id;
  assert.deepEqual([bare.project_type, bare.lifecycle_stage, bare.scale, bare.lat, bare.unit_count], [null, "Unknown", "Unknown", null, null]);
});

test("project validation follows the API error conventions", async () => {
  const bad = async (data: unknown, re: RegExp) => {
    const r = await api.call("POST", "/projects", { data });
    assert.equal(r.status, 400, `${JSON.stringify(data)} → ${r.status}`);
    assert.match(r.body.error, re);
  };
  await bad({ name: "" }, /name is required/);
  await bad({ name: "X", lifecycle_stage: "Demolished" }, /lifecycle stage/);
  await bad({ name: "X", project_type: "Spaceport" }, /project type/);
  await bad({ name: "X", scale: "Gigantic" }, /scale/);
  await bad({ name: "X", unit_count: 0 }, /positive/);
  await bad({ name: "X", building_count: -2 }, /positive/);
  await bad({ name: "X", built_up_area_sqft: "lots" }, /positive/);
  await bad({ name: "X", lat: 12.97 }, /both latitude/);
  await bad({ name: "X", lat: 28.6, lng: 77.2 }, /Bengaluru/);
  await bad({ name: "X", pincode: "56" }, /6 digits/);
  await bad({ name: "X", website: "not a url" }, /Website/);
  assert.equal((await api.call("POST", "/projects", {})).status, 400);
});

test("list / search / filter projects", async () => {
  await api.call("POST", "/projects", { data: { name: "Embassy Tech Village Block C", project_type: "Commercial", lifecycle_stage: "Design", area: "Bellandur", pincode: "560103", lat: 12.9302, lng: 77.6895 } });
  const names = async (qs: string) => (await api.call("GET", `/projects${qs}`)).body.map((p: { name: string }) => p.name);
  assert.deepEqual(await names(""), ["Brigade Lakeside Phase 1", "Embassy Tech Village Block C", "Hebbal Lake Tech Park"]);
  assert.deepEqual(await names("?q=lakeside"), ["Brigade Lakeside Phase 1"]);
  assert.deepEqual(await names("?q=thanisandra"), ["Brigade Lakeside Phase 1"], "search covers address/area");
  assert.deepEqual(await names("?stage=Design,Construction"), ["Brigade Lakeside Phase 1", "Embassy Tech Village Block C"]);
  assert.deepEqual(await names("?stage=Unknown"), ["Hebbal Lake Tech Park"]);
  assert.deepEqual(await names("?type=Commercial"), ["Embassy Tech Village Block C"]);
  assert.deepEqual(await names("?scale=Large"), ["Brigade Lakeside Phase 1"]);
  assert.deepEqual(await names("?area=bellandur"), ["Embassy Tech Village Block C"]);
  assert.deepEqual(await names("?pincode=560077"), ["Brigade Lakeside Phase 1"]);
  assert.deepEqual(await names("?near=13.06,77.63&radius=1000"), ["Brigade Lakeside Phase 1"]);
  assert.deepEqual(await names("?near=12.97,77.59&radius=1000"), []);
  assert.equal((await api.call("GET", "/projects?near=abc")).status, 400);
  assert.equal((await api.call("GET", "/projects?near=13,77.6&radius=999999")).status, 400);
  const row = (await api.call("GET", "/projects?q=lakeside")).body[0];
  assert.equal(row.stakeholder_count, 0);
  assert.deepEqual(row.stakeholders, []);
});

test("project detail and invalid ids", async () => {
  const d = await api.call("GET", `/projects/${ids.lakeside}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.project.name, "Brigade Lakeside Phase 1");
  assert.deepEqual([d.body.stakeholders, d.body.facts, d.body.crm_opportunities, d.body.water_opportunities], [[], [], [], []]);
  assert.equal((await api.call("GET", "/projects/999999")).status, 404);
  assert.equal((await api.call("GET", "/projects/abc")).status, 400);
  assert.equal((await api.call("GET", "/projects/0")).status, 400);
  assert.equal((await api.call("PATCH", "/projects/999999", { name: "x" })).status, 404);
  assert.equal((await api.call("GET", "/projects/999999/stakeholders")).status, 404);
  assert.equal((await api.call("GET", "/projects/999999/facts")).status, 404);
});

test("update project: changed values become Verified, cleared values Unknown, validation applies", async () => {
  const r = await api.call("PATCH", `/projects/${ids.techpark}`, { lifecycle_stage: "Design", project_type: "Commercial", unit_count: 12, lat: 13.035, lng: 77.597 }, AKASH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.lifecycle_stage, r.body.project_type, r.body.unit_count], ["Design", "Commercial", 12]);
  assert.deepEqual(r.body.field_sources.lifecycle_stage, { provenance: "Verified", source: "Edited by Akash" });
  assert.equal(r.body.field_sources.location.provenance, "Verified");
  assert.equal(r.body.updated_by_name, "Akash");
  const cleared = await api.call("PATCH", `/projects/${ids.techpark}`, { unit_count: null, lifecycle_stage: "" });
  assert.deepEqual([cleared.body.unit_count, cleared.body.lifecycle_stage], [null, "Unknown"]);
  assert.deepEqual(cleared.body.field_sources.unit_count, { provenance: "Unknown", source: null });
  assert.deepEqual(cleared.body.field_sources.lifecycle_stage, { provenance: "Unknown", source: null });
  const renamed = await api.call("PATCH", `/projects/${ids.techpark}`, { name: "Hebbal Lake Tech Park Tower 2" });
  assert.equal(renamed.body.name, "Hebbal Lake Tech Park Tower 2");
  assert.equal((await db().query(`SELECT normalized_name FROM projects WHERE id = $1`, [ids.techpark])).rows[0].normalized_name, "hebbal lake tech park tower 2");
  for (const body of [{ name: " " }, { lifecycle_stage: "Demolished" }, { unit_count: -1 }, { lat: 19.07, lng: 72.87 }, { project_type: "Spaceport" }]) {
    assert.equal((await api.call("PATCH", `/projects/${ids.techpark}`, body)).status, 400, JSON.stringify(body));
  }
  const unchanged = await api.call("PATCH", `/projects/${ids.techpark}`, {});
  assert.equal(unchanged.status, 200);
});

/* ---------------- Duplicate detection ---------------- */

test("duplicate detection: blocks likely duplicates, flags other phases, never merges automatically", async () => {
  const same = await api.call("POST", "/projects", { data: { name: "Brigade Lake Side - Phase 1", lat: 13.0602, lng: 77.6313, pincode: "560077" } });
  assert.equal(same.status, 409);
  assert.equal(same.body.duplicate.level, "existing");
  assert.equal(same.body.duplicate.candidates[0].id, ids.lakeside);
  assert.ok(same.body.duplicate.candidates[0].reasons.some((r: string) => /Same location/.test(r)));

  const phase2 = await api.call("POST", "/projects/check-duplicates", { name: "Brigade Lakeside Phase 2", lat: 13.0605, lng: 77.6318 });
  assert.equal(phase2.body.level, "possible_duplicate", "another phase is never auto-classified as the same project");
  assert.equal(phase2.body.candidates[0].separate_part, true);
  assert.ok(phase2.body.candidates[0].reasons.some((r: string) => /phase/i.test(r)));

  const byWebsite = await api.call("POST", "/projects/check-duplicates", { name: "Lakeside by Brigade", website: "https://www.brigadelakeside.in/" });
  assert.notEqual(byWebsite.body.level, "new");
  const unrelated = await api.call("POST", "/projects/check-duplicates", { name: "Prestige Falcon City", lat: 12.88, lng: 77.55 });
  assert.equal(unrelated.body.level, "new");
  const self = await api.call("POST", "/projects/check-duplicates", { ...lakeside, exclude_id: ids.lakeside });
  assert.equal(self.body.level, "new", "a project is not its own duplicate");

  // "Keep separate": force creates it; nothing was merged.
  const kept = await api.call("POST", "/projects", { data: { name: "Brigade Lakeside Phase 2", lat: 13.0605, lng: 77.6318, project_type: "Residential" }, force: true });
  assert.equal(kept.status, 201);
  ids.phase2 = kept.body.id;
  const merged = await db().query(`SELECT count(*)::int n FROM projects WHERE merged_into IS NOT NULL`);
  assert.equal(merged.rows[0].n, 0);
});

/* ---------------- Stakeholders ---------------- */

test("stakeholders: add, many organizations per project, many projects per organization, roles and primary flag", async () => {
  const add = (projectId: number, organization_id: number, role: string, extra = {}) =>
    api.call("POST", `/projects/${projectId}/stakeholders`, { organization_id, role, provenance: "Unverified", source: "Project brochure", ...extra });
  const a = await add(ids.lakeside, ids.developer, "Developer", { is_primary: true, confidence: "High", notes: "Brochure p.2" });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  ids.devLink = a.body.id;
  assert.deepEqual([a.body.role, a.body.is_primary, a.body.confidence, a.body.provenance, a.body.notes, a.body.source], ["Developer", true, "High", "Unverified", "Brochure p.2", "Project brochure"]);
  assert.equal(a.body.created_by_name, "Fayaas");
  ids.archLink = (await add(ids.lakeside, ids.architect, "Architect", { is_primary: true })).body.id;
  ids.conLink = (await add(ids.lakeside, ids.contractor, "Contractor")).body.id;
  await add(ids.lakeside, ids.mep, "MEP Consultant");
  await add(ids.phase2, ids.architect, "Architect");
  await add(ids.techpark, ids.architect, "Architect", { provenance: "Verified", source: null });

  const list = (await api.call("GET", `/projects/${ids.lakeside}/stakeholders`)).body;
  assert.deepEqual(list.map((s: { role: string; organization_name: string }) => `${s.role}:${s.organization_name}`).sort(), [
    "Architect:Mistry Architects",
    "Contractor:Shapoorji Civil Works",
    "Developer:Brigade Enterprises",
    "MEP Consultant:Spectral MEP Consultants",
  ]);
  const row = (await api.call("GET", "/projects?q=lakeside phase 1")).body[0];
  assert.equal(row.stakeholder_count, 4);
  assert.equal(row.stakeholders[0].role, "Developer", "summary ordered by role catalog order");
  assert.deepEqual((await api.call("GET", `/projects?organization_id=${ids.architect}`)).body.map((p: { name: string }) => p.name), [
    "Brigade Lakeside Phase 1",
    "Brigade Lakeside Phase 2",
    "Hebbal Lake Tech Park Tower 2",
  ]);
  assert.deepEqual((await api.call("GET", `/projects?role=Contractor`)).body.map((p: { id: number }) => p.id), [ids.lakeside]);

  // All agreed roles are accepted.
  const meta = (await api.call("GET", "/meta")).body;
  for (const r of ["Developer", "Architect", "Contractor", "MEP Consultant", "Plumbing Consultant", "Structural Consultant", "Project Manager", "Owner", "Operator", "Technology Provider", "Other"]) {
    assert.ok(meta.stakeholderRoles.includes(r), r);
  }
});

test("stakeholders: duplicates, invalid input and primary conflicts are rejected", async () => {
  const post = (body: object) => api.call("POST", `/projects/${ids.lakeside}/stakeholders`, body);
  const dup = await post({ organization_id: ids.developer, role: "Developer", provenance: "Verified" });
  assert.equal(dup.status, 409);
  assert.match(dup.body.error, /already linked/);
  assert.equal((await post({ organization_id: ids.hospital, role: "Developer", is_primary: true, provenance: "Verified" })).status, 409, "second primary developer");
  assert.equal((await post({ organization_id: ids.hospital, role: "Astronaut", provenance: "Verified" })).status, 400);
  assert.equal((await post({ organization_id: ids.hospital, role: "Owner" })).status, 400, "unverified without a source");
  assert.equal((await post({ organization_id: 999999, role: "Owner", provenance: "Verified" })).status, 404);
  assert.equal((await post({ organization_id: "abc", role: "Owner", provenance: "Verified" })).status, 400);
  assert.equal((await post({ organization_id: ids.hospital, provenance: "Verified" })).status, 400, "role required");
  assert.equal((await api.call("POST", `/projects/999999/stakeholders`, { organization_id: ids.hospital, role: "Owner", provenance: "Verified" })).status, 404);
  // Same organization in a second role on the same project is allowed.
  assert.equal((await post({ organization_id: ids.developer, role: "Owner", provenance: "Verified" })).status, 201);
});

test("stakeholders: update relationship (role, primary, notes, provenance) with conflict checks", async () => {
  const url = (link: number) => `/projects/${ids.lakeside}/stakeholders/${link}`;
  const r = await api.call("PATCH", url(ids.conLink), { role: "Structural Consultant", notes: "Changed after site visit", provenance: "Verified", confidence: "Medium" }, AKASH);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.role, r.body.notes, r.body.provenance, r.body.confidence, r.body.updated_by_name], ["Structural Consultant", "Changed after site visit", "Verified", "Medium", "Akash"]);
  assert.equal((await api.call("PATCH", url(ids.conLink), { role: "Architect", is_primary: true })).status, 409, "Mistry is already the primary architect");
  assert.equal((await api.call("PATCH", url(ids.conLink), { role: "Astronaut" })).status, 400);
  assert.equal((await api.call("PATCH", url(ids.devLink), { role: "Owner" })).status, 409, "developer already holds Owner on this project");
  assert.equal((await api.call("PATCH", url(ids.conLink), { provenance: "Unverified", source: "" })).status, 400);
  assert.equal((await api.call("PATCH", url(999999), { notes: "x" })).status, 404);
  assert.equal((await api.call("PATCH", `/projects/${ids.phase2}/stakeholders/${ids.conLink}`, { notes: "x" })).status, 404, "link must belong to the project");
  // Demote then promote another architect works.
  assert.equal((await api.call("PATCH", url(ids.archLink), { is_primary: false })).body.is_primary, false);
  const tl = (await api.call("GET", `/organizations/${ids.contractor}`)).body.activities.map((a: { summary: string }) => a.summary);
  assert.ok(tl.some((s: string) => s.startsWith("Project link updated: Brigade Lakeside Phase 1 (Contractor → Structural Consultant)")));
});

test("stakeholders: remove relationship keeps the history in the timeline and audit log", async () => {
  const r = await api.call("DELETE", `/projects/${ids.lakeside}/stakeholders/${ids.conLink}`, { reason: "Not involved after all" });
  assert.equal(r.status, 204);
  assert.equal((await api.call("DELETE", `/projects/${ids.lakeside}/stakeholders/${ids.conLink}`)).status, 404);
  const list = (await api.call("GET", `/projects/${ids.lakeside}/stakeholders`)).body;
  assert.ok(!list.some((s: { id: number }) => s.id === ids.conLink));
  const tl = (await api.call("GET", `/organizations/${ids.contractor}`)).body.activities.map((a: { summary: string }) => a.summary);
  assert.ok(tl.includes("Removed from project Brigade Lakeside Phase 1 as Structural Consultant (Not involved after all)"));
  const aud = await db().query<{ changes: { removed: { role: string } } }>(`SELECT changes FROM audit_logs WHERE entity = 'project_organization' AND entity_id = $1 AND action = 'delete'`, [ids.conLink]);
  assert.equal(aud.rows[0].changes.removed.role, "Structural Consultant");
});

/* ---------------- Organizations ↔ projects ---------------- */

test("organization detail and project list for an organization", async () => {
  const d = (await api.call("GET", `/organizations/${ids.architect}`)).body;
  assert.deepEqual(d.projects.map((p: { project_name: string; role: string }) => `${p.project_name}:${p.role}`), [
    "Brigade Lakeside Phase 1:Architect",
    "Brigade Lakeside Phase 2:Architect",
    "Hebbal Lake Tech Park Tower 2:Architect",
  ]);
  assert.equal(d.projects[0].lifecycle_stage, "Construction");
  assert.deepEqual(d.opportunities, []);
  const list = await api.call("GET", `/organizations/${ids.developer}/projects`);
  assert.deepEqual(list.body.map((p: { role: string }) => p.role).sort(), ["Developer", "Owner"]);
  assert.deepEqual((await api.call("GET", `/organizations/${ids.hospital}/projects`)).body, []);
  assert.equal((await api.call("GET", "/organizations/999999/projects")).status, 404);
  // The Organizations list itself is unchanged in shape and count.
  const orgs = (await api.call("GET", "/organizations")).body;
  assert.equal(orgs.length, 5);
});

/* ---------------- Project facts ---------------- */

test("project facts: create, change (versioned), withdraw; provenance and confidence retained", async () => {
  const url = `/projects/${ids.lakeside}/facts`;
  const a = await api.call("POST", url, { key: "water_requirement", value: "420", provenance: "Unverified", confidence: "Medium", source: "EIA report, Table 4", note: "Design figure" });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const f = a.body.fact;
  assert.deepEqual([f.value, f.provenance, f.confidence, f.source, f.note, f.created_by_name], ["420", "Unverified", "Medium", "EIA report, Table 4", "Design figure", "Fayaas"]);
  await api.call("POST", url, { key: "water_sources", value: "Tanker", provenance: "Verified" });

  // Change: only the value → provenance, confidence and source carry over; the old version is retired.
  const c = await api.call("PATCH", `${url}/${f.id}`, { value: 480 }, AKASH);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.deepEqual([c.body.fact.value, c.body.fact.provenance, c.body.fact.confidence, c.body.fact.source, c.body.fact.replaces_fact_id], ["480", "Unverified", "Medium", "EIA report, Table 4", f.id]);
  assert.deepEqual(c.body.retired, [f.id]);
  // Change provenance/confidence after verification.
  const v = await api.call("PATCH", `${url}/${c.body.fact.id}`, { provenance: "Verified", confidence: "High", source: "Confirmed by site engineer" });
  assert.deepEqual([v.body.fact.value, v.body.fact.provenance, v.body.fact.confidence], ["480", "Verified", "High"]);

  const active = (await api.call("GET", url)).body;
  assert.deepEqual(active.map((x: { fact_key: string; value: string }) => `${x.fact_key}=${x.value}`), ["water_requirement=480", "water_sources=Tanker"]);
  const all = (await api.call("GET", `${url}?include_retired=1`)).body.filter((x: { fact_key: string }) => x.fact_key === "water_requirement");
  assert.deepEqual(all.map((x: { value: string; provenance: string; retired_at: string | null }) => [x.value, x.provenance, Boolean(x.retired_at)]), [
    ["420", "Unverified", true],
    ["480", "Unverified", true],
    ["480", "Verified", false],
  ]);

  // Errors
  assert.equal((await api.call("PATCH", `${url}/${f.id}`, { value: 500 })).status, 409, "a retired version cannot be changed");
  assert.equal((await api.call("PATCH", `${url}/${v.body.fact.id}`, {})).status, 400, "nothing to change");
  assert.equal((await api.call("PATCH", `${url}/${v.body.fact.id}`, { value: "lots" })).status, 400);
  assert.equal((await api.call("PATCH", `/projects/${ids.phase2}/facts/${v.body.fact.id}`, { value: 1 })).status, 404, "fact belongs to another project");
  assert.equal((await api.call("POST", url, { key: "water_requirement", value: 1, provenance: "Unverified" })).status, 400, "source required");
  assert.equal((await api.call("POST", url, { key: "building_types", value: "Residential", provenance: "Verified" })).status, 400, "organization-only fact");
  assert.equal((await api.call("POST", url, { value: 1, provenance: "Verified" })).status, 400, "key required");
  assert.equal((await api.call("POST", url, { key: "water_notes", value: "x", provenance: "Verified", confidence: "Sure" })).status, 400);

  const tanker = active.find((x: { fact_key: string }) => x.fact_key === "water_sources");
  assert.equal((await api.call("DELETE", `${url}/${tanker.id}`)).status, 204);
  assert.equal((await api.call("DELETE", `${url}/${tanker.id}`)).status, 404);
  assert.ok(!(await api.call("GET", url)).body.some((x: { id: number }) => x.id === tanker.id));
  // Nothing generated facts automatically for other projects.
  assert.deepEqual((await api.call("GET", `/projects/${ids.phase2}/facts`)).body, []);
});

/* ---------------- CRM ---------------- */

test("CRM: existing organization-only opportunities keep working; projects, types and pipelines can be attached", async () => {
  // Existing, organization-only flow (what the CRM UI sends).
  const base = await api.call("POST", "/crm", { organization_id: ids.developer, owner_id: AKASH });
  assert.equal(base.status, 201);
  assert.deepEqual([base.body.status, base.body.pipeline, base.body.opportunity_type, base.body.project_id], ["New", "relationship", "Customer", null]);
  const again = await api.call("POST", "/crm", { organization_id: ids.developer });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, "This organization is already in the CRM");
  const interaction = await api.call("POST", `/crm/${base.body.id}/interactions`, { type: "contact_attempted" });
  assert.equal(interaction.body.status, "Contacted");

  // Same organization, project opportunity in the project pipeline (defaults from the type). Since Phase 7 the
  // customer must be a stakeholder on the project.
  for (const p of [ids.lakeside, ids.phase2]) await api.call("POST", `/projects/${p}/stakeholders`, { organization_id: ids.developer, role: "Developer", provenance: "Verified" });
  const proj = await api.call("POST", "/crm", { organization_id: ids.developer, project_id: ids.lakeside, opportunity_type: "Project Opportunity", title: "Greywater reuse for Lakeside" });
  assert.equal(proj.status, 201, JSON.stringify(proj.body));
  assert.deepEqual([proj.body.pipeline, proj.body.status, proj.body.project_id, proj.body.title], ["project", "Identified", ids.lakeside, "Greywater reuse for Lakeside"]);
  // Same organization, another relationship type.
  const partner = await api.call("POST", "/crm", { organization_id: ids.developer, opportunity_type: "Developer Relationship", status: "Contacted" });
  assert.equal(partner.status, 201);
  // Another project for the same organization and type is fine; the same project again is not.
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.developer, project_id: ids.phase2, opportunity_type: "Project Opportunity" })).status, 201);
  const dupProj = await api.call("POST", "/crm", { organization_id: ids.developer, project_id: ids.lakeside, opportunity_type: "Project Opportunity" });
  assert.equal(dupProj.status, 409);
  assert.match(dupProj.body.error, /already exists .* on Brigade Lakeside Phase 1/);

  // Validation
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.hospital, opportunity_type: "Bribe" })).status, 400);
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.hospital, pipeline: "imaginary" })).status, 400);
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.hospital, pipeline: "project", status: "Converted" })).status, 400);
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.hospital, project_id: 999999 })).status, 404);

  // Organization detail exposes all opportunities; the primary stays the original relationship one.
  const d = (await api.call("GET", `/organizations/${ids.developer}`)).body;
  assert.equal(d.opportunity.id, base.body.id);
  assert.equal(d.opportunities.length, 4);
  const list = (await api.call("GET", "/organizations?type=Real Estate Developer")).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].crm_opportunity_count, 4);
  // Project detail and CRM filters see the project opportunity.
  assert.deepEqual((await api.call("GET", `/projects/${ids.lakeside}`)).body.crm_opportunities.map((o: { id: number }) => o.id), [proj.body.id]);
  assert.equal((await api.call("GET", "/crm?pipeline=project")).body.length, 2);
  assert.equal((await api.call("GET", `/crm?project_id=${ids.lakeside}`)).body.length, 1);
  // A closed opportunity no longer blocks a new one of the same type.
  await api.call("PATCH", `/crm/${base.body.id}`, { status: "Lost" });
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.developer })).status, 201);
});

/* ---------------- Merge ---------------- */

test("project merge is an explicit human action and keeps history", async () => {
  const dup = (await api.call("POST", "/projects", { data: { name: "Brigade Lakeside Ph-1", unit_count: 640, description: "dup" }, force: true })).body.id;
  await api.call("POST", `/projects/${dup}/facts`, { key: "green_certification", value: "IGBC Gold", provenance: "Unverified", source: "Brochure" });
  await api.call("POST", `/projects/${dup}/stakeholders`, { organization_id: ids.hospital, role: "Operator", provenance: "Verified" });
  const m = await api.call("POST", `/projects/${dup}/merge-into/${ids.lakeside}`);
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.deepEqual((await api.call("GET", `/projects/${dup}`)).body, { merged_into: ids.lakeside });
  const d = (await api.call("GET", `/projects/${ids.lakeside}`)).body;
  assert.ok(d.facts.some((f: { value: string }) => f.value === "IGBC Gold"));
  assert.ok(d.stakeholders.some((s: { role: string }) => s.role === "Operator"));
  assert.ok(!(await api.call("GET", "/projects")).body.some((p: { id: number }) => p.id === dup), "merged project hidden from lists");
  assert.equal((await api.call("POST", `/projects/${ids.lakeside}/merge-into/${ids.lakeside}`)).status, 400);
  assert.equal((await api.call("POST", `/projects/${dup}/merge-into/${ids.lakeside}`)).status, 409);
});

/* ---------------- Imports ---------------- */

test("imports: organization records unchanged; the model distinguishes organization / project / mixed batches", async () => {
  // Organization-only feed (existing behaviour)
  const orgOnly = await api.call("POST", "/imports/json", { source_label: "Org feed", records: [{ name: "Sunrise School", address: "Sarjapur, Bengaluru" }] });
  const oi = await waitForImport(api, orgOnly.body.id);
  assert.deepEqual([oi.kind, oi.status, oi.stats.organizations, oi.stats.projects], ["organizations", "review", 1, 0]);
  assert.equal(oi.records[0].entity_type, "organization");
  const ok = await api.call("POST", `/imports/${orgOnly.body.id}/records/0/approve`);
  assert.equal(ok.body.status, "approved");
  assert.ok(ok.body.result_org_id);

  // Mixed feed: one organization, two projects (one valid, one needing a fix, one duplicate of an existing project)
  const mixed = await api.call("POST", "/imports/json", {
    source_label: "RERA extract",
    records: [
      { name: "Prestige Builders", org_type: "Builder" },
      { entity_type: "project", name: "Prestige Falcon City", project_type: "Residential", lifecycle_stage: "Construction", pincode: "560062", unit_count: 2500 },
      { entity_type: "project", name: "Broken Project", lifecycle_stage: "Demolished" },
      { entity_type: "project", name: "Brigade Lakeside Phase 1", lat: 13.0601, lng: 77.6312 },
    ],
  });
  const mi = await waitForImport(api, mixed.body.id);
  assert.deepEqual([mi.kind, mi.stats.found, mi.stats.organizations, mi.stats.projects], ["mixed", 4, 1, 3]);
  assert.deepEqual(mi.records.map((r: { entity_type: string }) => r.entity_type), ["organization", "project", "project", "project"]);
  assert.ok(mi.records[2].warnings[0].includes("Needs a fix before approval"));
  assert.equal(mi.records[3].duplicate.level, "existing");
  assert.equal(mi.records[3].duplicate.candidates[0].id, ids.lakeside);
  assert.equal((await api.call("GET", "/projects?q=falcon")).body.length, 0, "nothing saved before review");

  const ap = await api.call("POST", `/imports/${mixed.body.id}/records/1/approve`);
  assert.equal(ap.body.status, "approved", JSON.stringify(ap.body));
  const created = (await api.call("GET", `/projects/${ap.body.result_project_id}`)).body.project;
  assert.deepEqual([created.name, created.unit_count, created.lifecycle_stage], ["Prestige Falcon City", 2500, "Construction"]);
  assert.match(created.source_label, /RERA extract/);
  assert.equal((await api.call("POST", `/imports/${mixed.body.id}/records/2/approve`)).status, 400, "invalid record cannot be approved as-is");
  const fixed = await api.call("POST", `/imports/${mixed.body.id}/records/2/edit`, { data: { lifecycle_stage: "Design" } });
  assert.equal(fixed.body.data.lifecycle_stage, "Design");
  assert.deepEqual(fixed.body.warnings, ["Location unknown — the project will not appear on the map until a location is set"]);
  assert.equal((await api.call("POST", `/imports/${mixed.body.id}/records/3/approve`)).status, 409, "duplicate project needs a human decision");
  assert.equal((await api.call("POST", `/imports/${mixed.body.id}/records/3/merge`, {})).status, 400, "project merge from import not supported yet");
  assert.equal((await api.call("POST", `/imports/${mixed.body.id}/records/3/reject`)).body.status, "rejected");

  // Project-only feed and validation of entity_type
  const po = await api.call("POST", "/imports/json", { records: [{ entity_type: "project", name: "Sobha Dream Acres" }] });
  assert.equal((await waitForImport(api, po.body.id)).kind, "projects");
  assert.equal((await api.call("POST", "/imports/json", { records: [{ entity_type: "spaceship", name: "x" }] })).status, 400);
  // Imports created before migration 0007 (no entity_type in records) still read as organizations.
  const legacy = await db().query<{ id: number }>(
    `INSERT INTO imports (filename, file_type, status, records) VALUES ('old.csv', 'csv', 'review', $1) RETURNING id`,
    [JSON.stringify([{ index: 0, data: { name: "Legacy Org" }, field_sources: {}, warnings: [], duplicate: { level: "new", candidates: [] }, status: "pending", result_org_id: null }])],
  );
  const li = (await api.call("GET", `/imports/${legacy.rows[0].id}`)).body;
  assert.deepEqual([li.kind, li.stats.organizations, li.stats.projects], ["organizations", 1, 0]);
  assert.equal((await api.call("POST", `/imports/${legacy.rows[0].id}/records/0/approve`)).body.status, "approved");
});
