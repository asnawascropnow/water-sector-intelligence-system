import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { ORG_TYPES } from "../../shared/constants";
import { HttpError } from "../lib/http";
import { addFact, listFacts, retireFact } from "../lib/facts";
import { addStakeholder, createProject, organizationProjects, projectStakeholders } from "../lib/projects";
import { createWaterOpportunity, reviewWaterOpportunity, suggestWaterOpportunity } from "../lib/waterOpportunities";
import { startTestApi, type TestApi } from "./helpers";

// WSIS Phase 2 data model: catalog, facts, projects, stakeholders, water opportunities, pipelines,
// multiple CRM opportunities — through the service layer, the API, and the raw database constraints.

let api: TestApi;
const ids: Record<string, number> = {};
const FAYAAS = 1;
const AKASH = 2;
const src = { sourceId: null, sourceLabel: "Test fixture", actorId: FAYAAS };

/** Assert that a promise rejects with an HttpError of the given status. */
async function rejectsHttp(p: Promise<unknown>, status: number, re?: RegExp) {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof HttpError, `expected HttpError, got ${e}`);
    assert.equal(e.status, status, e.message);
    if (re) assert.match(e.message, re);
    return true;
  });
}

before(async () => {
  api = await startTestApi();
  const mk = async (name: string, org_type: string) => {
    const r = await api.call("POST", "/organizations", { data: { name, org_type }, force: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id as number;
  };
  ids.architect = await mk("Mistry Architects", "Architect");
  ids.developer = await mk("Brigade Lakeside Developers", "Real Estate Developer");
  ids.contractor = await mk("Shapoorji Civil Contractors", "Civil Contractor");
  ids.hospital = await mk("Lakeview Hospital", "Hospital");
});
after(() => api.close());

/* ---------------- Catalog & organization types ---------------- */

test("GET /api/meta serves the catalogs; the MVP type list is a subset of the catalog", async () => {
  const { status, body } = await api.call("GET", "/meta");
  assert.equal(status, 200);
  const names = body.organizationTypes.map((t: { name: string }) => t.name);
  for (const t of ORG_TYPES) assert.ok(names.includes(t), t);
  assert.ok(names.includes("Architecture Firm") && names.includes("Water Technology Company"));
  assert.deepEqual(
    body.organizationTypeGroups.map((g: { key: string }) => g.key),
    ["water_ecosystem", "built_environment", "demand_side", "public_sector", "research_education", "civil_society", "other"],
  );
  assert.ok(body.stakeholderRoles.includes("Architect") && body.stakeholderRoles.includes("Developer"));
  assert.ok(body.waterInterventionTypes.includes("Rainwater Harvesting"));
  assert.deepEqual(body.pipelines.map((p: { key: string }) => p.key), ["relationship", "project"]);
  assert.equal(body.pipelines[1].stages.length, 11, "9 main-track stages + Lost and Nurture outcomes (Phase 7)");
  const fact = body.factDefinitions.find((f: { key: string }) => f.key === "building_types");
  assert.ok(Array.isArray(fact.allowed_values) && fact.allowed_values.includes("Mixed-use"));
  assert.deepEqual(fact.type_groups, ["built_environment"]);
  assert.equal(body.lifecycleStages[0], "Concept");
});

test("architect / developer / contractor organizations can be created and retyped via the existing API", async () => {
  const detail = (await api.call("GET", `/organizations/${ids.architect}`)).body.organization;
  assert.equal(detail.org_type, "Architect");
  assert.equal(detail.field_sources.org_type.provenance, "Unverified", "a type the user gave is not an AI inference");
  assert.equal((await api.call("GET", `/organizations/${ids.developer}`)).body.organization.org_type, "Real Estate Developer");
  const re = await api.call("PATCH", `/organizations/${ids.contractor}`, { org_type: "construction company" });
  assert.equal(re.status, 200);
  assert.equal(re.body.org_type, "Construction Company", "case-insensitive match to the canonical catalog name");
  assert.equal((await api.call("PATCH", `/organizations/${ids.contractor}`, { org_type: "Spaceport" })).status, 400);
  const list = (await api.call("GET", "/organizations?type=Architect")).body;
  assert.deepEqual(list.map((o: { name: string }) => o.name), ["Mistry Architects"]);
});

test("an unknown type on create still falls back to the MVP heuristics (no new behaviour for imports/forms)", async () => {
  const r = await api.call("POST", "/organizations", { data: { name: "Sunrise School", org_type: "Spaceport" }, force: true });
  const o = (await api.call("GET", `/organizations/${r.body.id}`)).body.organization;
  assert.equal(o.org_type, "School");
  assert.equal(o.field_sources.org_type.provenance, "AI Inference");
});

/* ---------------- Projects ---------------- */

test("project creation: normalised, provenance-labelled, nothing guessed", async () => {
  const p = await createProject(db(), { name: "  Brigade Lakeside Phase 2 ", project_type: "Residential", address: "Off Hennur Road, Thanisandra, Bengaluru 560077", lat: 13.06, lng: 77.63, unit_count: 640, lifecycle_stage: "Design" }, src);
  ids.projectA = p.id;
  assert.equal(p.name, "Brigade Lakeside Phase 2");
  assert.equal(p.pincode, "560077");
  assert.equal(p.area, "Thanisandra");
  assert.deepEqual(p.field_sources.pincode, { provenance: "Unverified", source: "Parsed from address" });
  assert.equal(p.field_sources.unit_count.source, "Test fixture");
  assert.equal(p.scale, "Unknown", "scale not supplied → Unknown, never estimated");
  assert.equal(p.built_up_area_sqft, null);
  assert.equal(p.lifecycle_stage, "Design");
  assert.equal(p.city, "Bengaluru");
  assert.ok(Math.abs(p.lat! - 13.06) < 1e-9);
  const b = await createProject(db(), { name: "Mistry Campus Block C" }, src);
  ids.projectB = b.id;
  assert.equal(b.project_type, null);
  assert.equal(b.lifecycle_stage, "Unknown");
  assert.equal(b.data_confidence, "Low");
});

test("project validation rejects bad input (service layer and database constraints)", async () => {
  await rejectsHttp(createProject(db(), { name: " " }, src), 400, /name is required/);
  await rejectsHttp(createProject(db(), { name: "X", project_type: "Spaceport" }, src), 400, /project type/);
  await rejectsHttp(createProject(db(), { name: "X", lifecycle_stage: "Demolished" as never }, src), 400, /lifecycle/);
  await rejectsHttp(createProject(db(), { name: "X", lat: 19.07, lng: 72.87 }, src), 400, /Bengaluru/);
  await rejectsHttp(createProject(db(), { name: "X", lat: 12.97 }, src), 400, /both latitude/);
  await rejectsHttp(createProject(db(), { name: "X", unit_count: -5 }, src), 400, /positive/);
  await rejectsHttp(createProject(db(), { name: "X", building_count: 2.5 }, src), 400, /whole number/);
  await rejectsHttp(createProject(db(), { name: "X", pincode: "5600" }, src), 400, /6 digits/);
  const ins = (cols: string, vals: string) => db().query(`INSERT INTO projects (name, normalized_name, ${cols}) VALUES ('Y', 'y', ${vals})`);
  await assert.rejects(ins("lifecycle_stage", "'Demolished'"), /check constraint/);
  await assert.rejects(ins("unit_count", "0"), /check constraint/);
  await assert.rejects(ins("pincode", "'ABC123'"), /check constraint/);
  await assert.rejects(ins("project_type", "'Spaceport'"), /foreign key/);
  await assert.rejects(db().query(`INSERT INTO projects (name, normalized_name) VALUES ('  ', '')`), /check constraint/);
});

/* ---------------- Stakeholders ---------------- */

test("organizations ↔ projects are many-to-many, with roles, logged on the organization timeline", async () => {
  const link = (projectId: number, organizationId: number, role: string, extra = {}) =>
    addStakeholder(db(), { projectId, organizationId, role, provenance: "Unverified", source: "Brochure p.4", ...extra }, FAYAAS);
  await link(ids.projectA, ids.architect, "Architect", { isPrimary: true });
  await link(ids.projectA, ids.developer, "Developer", { isPrimary: true });
  await link(ids.projectA, ids.contractor, "Contractor");
  await link(ids.projectB, ids.architect, "Architect");
  await link(ids.projectB, ids.architect, "Landscape Architect"); // same org, second role on the same project

  const a = await projectStakeholders(db(), ids.projectA);
  assert.deepEqual(a.map((s) => [s.role, s.organization_name]).sort(), [["Architect", "Mistry Architects"], ["Contractor", "Shapoorji Civil Contractors"], ["Developer", "Brigade Lakeside Developers"]]);
  const archProjects = await organizationProjects(db(), ids.architect);
  assert.deepEqual([...new Set(archProjects.map((p) => p.project_name))].sort(), ["Brigade Lakeside Phase 2", "Mistry Campus Block C"]);
  assert.equal(archProjects.length, 3);
  const timeline = (await api.call("GET", `/organizations/${ids.architect}`)).body.activities.map((x: { summary: string }) => x.summary);
  assert.ok(timeline.some((s: string) => s === "Linked to project Brigade Lakeside Phase 2 as Architect (Unverified, source: Brochure p.4)"));
});

test("stakeholder uniqueness: one row per org+role per project, one primary per role, sourced links only", async () => {
  await rejectsHttp(addStakeholder(db(), { projectId: ids.projectA, organizationId: ids.architect, role: "Architect", provenance: "Verified" }, FAYAAS), 409, /already linked/);
  await rejectsHttp(addStakeholder(db(), { projectId: ids.projectA, organizationId: ids.hospital, role: "Architect", provenance: "Verified", isPrimary: true }, FAYAAS), 409, /already the primary/);
  await rejectsHttp(addStakeholder(db(), { projectId: ids.projectA, organizationId: ids.hospital, role: "Astronaut", provenance: "Verified" }, FAYAAS), 400, /role/);
  await rejectsHttp(addStakeholder(db(), { projectId: ids.projectA, organizationId: ids.hospital, role: "Owner", provenance: "Unverified" }, FAYAAS), 400, /cite a source/);
  await rejectsHttp(addStakeholder(db(), { projectId: 99999, organizationId: ids.hospital, role: "Owner", provenance: "Verified" }, FAYAAS), 404);
  // A second, non-primary architect on the same project is fine.
  await addStakeholder(db(), { projectId: ids.projectA, organizationId: ids.hospital, role: "Architect", provenance: "Verified" }, FAYAAS);
  // Raw database constraints back this up.
  const raw = (org: number, role: string, primary: boolean) =>
    db().query(`INSERT INTO project_organizations (project_id, organization_id, role, is_primary, provenance) VALUES ($1, $2, $3, $4, 'Verified')`, [ids.projectA, org, role, primary]);
  await assert.rejects(raw(ids.architect, "Architect", false), /duplicate key/);
  await assert.rejects(raw(ids.contractor, "Developer", true), /duplicate key/);
  await assert.rejects(
    db().query(`INSERT INTO project_organizations (project_id, organization_id, role, provenance) VALUES ($1, $2, 'Owner', 'Unverified')`, [ids.projectA, ids.hospital]),
    /check constraint/,
  );
});

/* ---------------- Facts ---------------- */

test("organization facts: canonical values, provenance + source required, history kept on replace", async () => {
  const r = await addFact(db(), "organization", ids.architect, { key: "building_types", value: "residential", provenance: "Unverified", source: "https://example-architects.in/projects" }, FAYAAS);
  assert.equal(r.fact.value, "Residential", "enum values are canonicalised");
  assert.deepEqual(r.warnings, []);
  await addFact(db(), "organization", ids.architect, { key: "building_types", value: "Healthcare", provenance: "Unverified", source: "Firm website" }, FAYAAS);
  await rejectsHttp(addFact(db(), "organization", ids.architect, { key: "building_types", value: "Residential", provenance: "Verified" }, FAYAAS), 409, /already has/);
  await rejectsHttp(addFact(db(), "organization", ids.architect, { key: "building_types", value: "Spaceports", provenance: "Verified" }, FAYAAS), 400, /not a valid value/);
  await rejectsHttp(addFact(db(), "organization", ids.architect, { key: "stp_experience", value: "maybe", provenance: "Verified" }, FAYAAS), 400, /yes or no/);
  await rejectsHttp(addFact(db(), "organization", ids.architect, { key: "influence_level", value: "High", provenance: "Unverified" }, FAYAAS), 400, /cite a source/);
  await rejectsHttp(addFact(db(), "organization", ids.architect, { key: "water_requirement", value: 50, provenance: "Verified" }, FAYAAS), 400, /applies to projects/);
  await rejectsHttp(addFact(db(), "organization", ids.architect, { key: "made_up_fact", value: "x", provenance: "Verified" }, FAYAAS), 400, /Unknown fact/);
  await rejectsHttp(addFact(db(), "organization", ids.architect, { key: "influence_reason", value: "  ", provenance: "Verified" }, FAYAAS), 400, /value is required/);

  const stp = await addFact(db(), "organization", ids.architect, { key: "stp_experience", value: true, provenance: "Verified", confidence: "High" }, FAYAAS);
  assert.equal(stp.fact.value, "Yes");
  // Single-valued: replacing retires the old value but keeps it.
  await addFact(db(), "organization", ids.architect, { key: "influence_level", value: "Medium", provenance: "AI Inference", source: "Opportunity agent" }, FAYAAS);
  const repl = await addFact(db(), "organization", ids.architect, { key: "influence_level", value: "high", provenance: "Verified" }, AKASH);
  assert.equal(repl.retired.length, 1);
  const active = await listFacts(db(), "organization", ids.architect);
  assert.deepEqual(active.filter((f) => f.fact_key === "influence_level").map((f) => [f.value, f.provenance]), [["High", "Verified"]]);
  const all = await listFacts(db(), "organization", ids.architect, { includeRetired: true });
  assert.equal(all.filter((f) => f.fact_key === "influence_level").length, 2, "history kept");

  await retireFact(db(), "organization", stp.fact.id, FAYAAS);
  assert.ok(!(await listFacts(db(), "organization", ids.architect)).some((f) => f.id === stp.fact.id));
  await rejectsHttp(retireFact(db(), "organization", stp.fact.id, FAYAAS), 404);

  // Facts meant for another type group are allowed but flagged.
  const warn = await addFact(db(), "organization", ids.hospital, { key: "green_building_experience", value: "no", provenance: "Verified" }, FAYAAS);
  assert.match(warn.warnings[0], /built environment/);

  const timeline = (await api.call("GET", `/organizations/${ids.architect}`)).body.activities.map((x: { summary: string }) => x.summary);
  assert.ok(timeline.includes("Building types: Residential (Unverified, source: https://example-architects.in/projects)"));
  // Database backs up the rules.
  await assert.rejects(db().query(`INSERT INTO organization_facts (organization_id, fact_key, value, provenance) VALUES ($1, 'certifications', 'IGBC', 'Unverified')`, [ids.architect]), /check constraint/);
  await assert.rejects(db().query(`INSERT INTO organization_facts (organization_id, fact_key, value, provenance) VALUES ($1, 'certifications', 'IGBC', 'Unknown')`, [ids.architect]), /check constraint/);
  await db().query(`INSERT INTO organization_facts (organization_id, fact_key, value, provenance) VALUES ($1, 'certifications', 'IGBC', 'Verified')`, [ids.architect]);
  await assert.rejects(db().query(`INSERT INTO organization_facts (organization_id, fact_key, value, provenance) VALUES ($1, 'certifications', 'igbc', 'Verified')`, [ids.architect]), /duplicate key/);
});

test("project facts: water intelligence with units, numbers validated", async () => {
  const w = await addFact(db(), "project", ids.projectA, { key: "water_requirement", value: "1,200", provenance: "Unverified", source: "EIA report" }, FAYAAS);
  assert.equal(w.fact.value, "1200");
  await addFact(db(), "project", ids.projectA, { key: "water_sources", value: "tanker", provenance: "Unverified", source: "Site visit" }, FAYAAS);
  await addFact(db(), "project", ids.projectA, { key: "water_sources", value: "Groundwater", provenance: "Unverified", source: "Site visit" }, FAYAAS);
  await rejectsHttp(addFact(db(), "project", ids.projectA, { key: "water_requirement", value: "lots", provenance: "Verified" }, FAYAAS), 400, /number/);
  await rejectsHttp(addFact(db(), "project", ids.projectA, { key: "building_types", value: "Residential", provenance: "Verified" }, FAYAAS), 400, /applies to organizations/);
  await rejectsHttp(addFact(db(), "project", 99999, { key: "water_notes", value: "x", provenance: "Verified" }, FAYAAS), 404);
  const facts = await listFacts(db(), "project", ids.projectA);
  assert.deepEqual(facts.map((f) => [f.fact_key, f.value]), [["water_requirement", "1200"], ["water_sources", "Tanker"], ["water_sources", "Groundwater"]]);
});

/* ---------------- Water opportunities ---------------- */

test("water opportunities: AI suggestions stay suggestions until a named person approves them", async () => {
  const s = await suggestWaterOpportunity(db(), { projectId: ids.projectA, interventionType: "Greywater Reuse", potential: "High", reason: "640 units at design stage; tanker and groundwater dependence recorded", agent: "water_intervention" });
  assert.deepEqual([s.status, s.provenance, s.origin, s.reviewed_by], ["suggested", "AI Inference", "ai", null]);
  // The database refuses to let it past 'suggested' without a reviewer, or to link it to CRM.
  await assert.rejects(db().query(`UPDATE water_opportunities SET status = 'approved' WHERE id = $1`, [s.id]), /check constraint/);
  const opp = (await api.call("POST", "/crm", { organization_id: ids.developer })).body;
  await assert.rejects(db().query(`UPDATE water_opportunities SET crm_opportunity_id = $2 WHERE id = $1`, [s.id, opp.id]), /check constraint/);
  await assert.rejects(db().query(`UPDATE water_opportunities SET origin = 'ai', provenance = 'Verified' WHERE id = $1`, [s.id]), /check constraint/);
  await rejectsHttp(reviewWaterOpportunity(db(), s.id, "approve", null), 400, /named person/);

  const approved = await reviewWaterOpportunity(db(), s.id, "approve", AKASH, "Developer confirmed interest");
  assert.deepEqual([approved.status, approved.reviewed_by, approved.provenance], ["approved", AKASH, "AI Inference"]);
  assert.ok(approved.reviewed_at);
  await rejectsHttp(reviewWaterOpportunity(db(), s.id, "reject", AKASH), 409, /Already approved/);
  // Linking to CRM is allowed only now — and only explicitly; nothing created a CRM record automatically.
  await db().query(`UPDATE water_opportunities SET crm_opportunity_id = $2 WHERE id = $1`, [s.id, opp.id]);
  const crmCount = (await api.call("GET", "/crm")).body.length;
  assert.equal(crmCount, 1);
});

test("water opportunities: manual entries, duplicates, rejection, targets", async () => {
  const m = await createWaterOpportunity(db(), { organizationId: ids.hospital, interventionType: "STP", potential: "Medium", reason: "Facility manager said the STP is overloaded", provenance: "Verified" }, FAYAAS);
  assert.deepEqual([m.status, m.reviewed_by, m.origin], ["approved", FAYAAS, "manual"]);
  await rejectsHttp(createWaterOpportunity(db(), { organizationId: ids.hospital, interventionType: "STP", reason: "again", provenance: "Verified" }, FAYAAS), 409, /already exists/);
  await rejectsHttp(createWaterOpportunity(db(), { organizationId: ids.hospital, interventionType: "Leak Detection", reason: "x", provenance: "AI Inference" }, FAYAAS), 400, /suggestion review/);
  await rejectsHttp(createWaterOpportunity(db(), { interventionType: "STP", reason: "x", provenance: "Verified" }, FAYAAS), 400, /project or an organization/);
  await rejectsHttp(createWaterOpportunity(db(), { projectId: ids.projectB, interventionType: "Teleportation", reason: "x", provenance: "Verified" }, FAYAAS), 400, /intervention type/);
  await rejectsHttp(createWaterOpportunity(db(), { projectId: ids.projectB, interventionType: "STP", reason: " ", provenance: "Verified" }, FAYAAS), 400, /why/);

  const s = await suggestWaterOpportunity(db(), { projectId: ids.projectB, interventionType: "Rainwater Harvesting", reason: "Large roof area (inferred from campus type)", agent: "water_intervention" });
  const r = await reviewWaterOpportunity(db(), s.id, "reject", FAYAAS, "Already has RWH");
  assert.equal(r.status, "rejected");
  // A rejected suggestion does not block a new one for the same intervention.
  await suggestWaterOpportunity(db(), { projectId: ids.projectB, interventionType: "Rainwater Harvesting", reason: "New evidence", agent: "water_intervention" });
  // Project + organization together (the developer's opportunity on a specific project).
  const both = await createWaterOpportunity(db(), { projectId: ids.projectA, organizationId: ids.developer, interventionType: "Smart Water Monitoring", reason: "Asked for metering quote", provenance: "Verified" }, AKASH);
  assert.equal(both.project_id, ids.projectA);
  const tl = (await api.call("GET", `/organizations/${ids.hospital}`)).body.activities.map((x: { summary: string }) => x.summary);
  assert.ok(tl.includes("Water opportunity added: STP — Facility manager said the STP is overloaded"));
});

/* ---------------- CRM preparation ---------------- */

test("an organization can hold several CRM opportunities; existing API behaviour is unchanged", async () => {
  // The MVP API still allows one opportunity per organization through POST /crm …
  const first = await api.call("POST", "/crm", { organization_id: ids.architect, owner_id: AKASH });
  assert.equal(first.status, 201);
  assert.deepEqual([first.body.pipeline, first.body.opportunity_type, first.body.project_id], ["relationship", "Customer", null]);
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.architect })).status, 409);
  // … but the schema now supports more: an architect-partner relationship and a project opportunity.
  await db().query(`INSERT INTO crm_opportunities (organization_id, opportunity_type, title) VALUES ($1, 'Architect Partner', 'Specify greywater systems')`, [ids.architect]);
  await db().query(
    `INSERT INTO crm_opportunities (organization_id, pipeline, opportunity_type, project_id, status) VALUES ($1, 'project', 'Project Opportunity', $2, 'Identified')`,
    [ids.architect, ids.projectA],
  );
  // No duplicate *open* opportunity of the same type for the same organization and project.
  await assert.rejects(db().query(`INSERT INTO crm_opportunities (organization_id, opportunity_type) VALUES ($1, 'Architect Partner')`, [ids.architect]), /duplicate key/);
  await db().query(`UPDATE crm_opportunities SET status = 'Lost' WHERE organization_id = $1 AND opportunity_type = 'Architect Partner'`, [ids.architect]);
  await db().query(`INSERT INTO crm_opportunities (organization_id, opportunity_type) VALUES ($1, 'Architect Partner')`, [ids.architect]);

  // Lists show the organization once, with the relationship opportunity as its primary.
  const list = (await api.call("GET", "/organizations?type=Architect")).body;
  assert.equal(list.length, 1);
  assert.equal(list[0].opportunity_id, first.body.id);
  assert.equal(list[0].crm_opportunity_count, 4);
  const detail = (await api.call("GET", `/organizations/${ids.architect}`)).body;
  assert.equal(detail.opportunity.id, first.body.id);
  // A task created for the organization attaches to the primary opportunity.
  const t = await api.call("POST", "/tasks", { organization_id: ids.architect, title: "Send portfolio" });
  assert.equal(t.body.opportunity_id, first.body.id);
  // Stage changes are validated against the opportunity's own pipeline.
  assert.equal((await api.call("PATCH", `/crm/${first.body.id}`, { status: "Meeting" })).status, 400);
  const proj = (await api.call("GET", "/crm")).body.find((o: { pipeline: string }) => o.pipeline === "project");
  assert.equal((await api.call("PATCH", `/crm/${proj.id}`, { status: "Meeting" })).body.status, "Meeting");
  assert.equal((await api.call("PATCH", `/crm/${proj.id}`, { status: "Proposal Sent" })).status, 400);
});

test("merging organizations carries facts, project links and water opportunities without collisions", async () => {
  const dup = (await api.call("POST", "/organizations", { data: { name: "Mistry Architects LLP", org_type: "Architect" }, force: true })).body.id;
  await addFact(db(), "organization", dup, { key: "certifications", value: "GRIHA", provenance: "Verified" }, FAYAAS);
  await addFact(db(), "organization", dup, { key: "certifications", value: "IGBC", provenance: "Verified" }, FAYAAS); // target already has IGBC
  await addStakeholder(db(), { projectId: ids.projectB, organizationId: dup, role: "Architect", provenance: "Verified" }, FAYAAS); // target already Architect on B
  await addStakeholder(db(), { projectId: ids.projectA, organizationId: dup, role: "MEP Consultant", provenance: "Verified" }, FAYAAS);
  const m = await api.call("POST", `/organizations/${dup}/merge-into/${ids.architect}`);
  assert.equal(m.status, 200, JSON.stringify(m.body));
  const certs = (await listFacts(db(), "organization", ids.architect)).filter((f) => f.fact_key === "certifications").map((f) => f.value).sort();
  assert.deepEqual(certs, ["GRIHA", "IGBC"]);
  const roles = (await organizationProjects(db(), ids.architect)).map((p) => `${p.project_name}:${p.role}`).sort();
  assert.ok(roles.includes("Brigade Lakeside Phase 2:MEP Consultant"));
  assert.equal(roles.filter((r) => r === "Mistry Campus Block C:Architect").length, 1, "no duplicate role after merge");
  // The colliding rows were kept on the merged record, not deleted.
  const kept = await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM project_organizations WHERE organization_id = $1`, [dup]);
  assert.equal(kept.rows[0].n, 1);
});

test("MVP pages' data is unaffected: dashboard summary, map data and daily brief still work", async () => {
  const s = (await api.call("GET", "/dashboard/summary")).body;
  assert.equal(typeof s.totalOrganizations, "number");
  const orgs = (await api.call("GET", "/organizations")).body;
  assert.equal(new Set(orgs.map((o: { id: number }) => o.id)).size, orgs.length, "no organization listed twice");
  const brief = await api.call("GET", "/ai/daily-brief");
  assert.equal(brief.status, 200);
});
