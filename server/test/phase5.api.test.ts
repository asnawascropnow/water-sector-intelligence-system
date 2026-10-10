import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { suggestWaterOpportunity } from "../lib/waterOpportunities";
import { startTestApi, type TestApi } from "./helpers";

// WSIS Phase 5: data the new Projects / Organization Details UI depends on.

let api: TestApi;
const ids: Record<string, number> = {};

before(async () => {
  api = await startTestApi();
  const org = async (key: string, name: string, org_type: string) => {
    const r = await api.call("POST", "/organizations", { data: { name, org_type }, force: true });
    ids[key] = r.body.id;
  };
  await org("architect", "Mistry Architects", "Architect");
  await org("developer", "Brigade Enterprises", "Real Estate Developer");
  await org("contractor", "Shapoorji Civil Works", "Civil Contractor");
  await org("hospital", "Lakeview Hospital", "Hospital");
  ids.p1 = (await api.call("POST", "/projects", { data: { name: "Brigade Lakeside Phase 1", project_type: "Residential", lifecycle_stage: "Design", area: "Thanisandra", lat: 13.06, lng: 77.63 } })).body.id;
  ids.p2 = (await api.call("POST", "/projects", { data: { name: "Hebbal Tech Park", project_type: "Commercial", area: "Hebbal" } })).body.id;
});
after(() => api.close());

test("fact profiles: architect, developer and contractor facts come from the catalog", async () => {
  const meta = (await api.call("GET", "/meta")).body;
  const byProfile = (p: string) => meta.factDefinitions.filter((d: { profiles: string[] | null }) => d.profiles?.includes(p)).map((d: { key: string }) => d.key);
  const arch = byProfile("architects");
  for (const k of ["building_types", "green_building_experience", "water_conservation_experience", "rainwater_harvesting_experience", "wastewater_reuse_experience", "stp_experience", "greywater_experience", "water_efficient_design", "sustainable_architecture", "esg_focus", "influence_level", "influence_reason"]) {
    assert.ok(arch.includes(k), `architects: ${k}`);
  }
  const dev = byProfile("developers");
  for (const k of ["developer_type", "developer_project_types", "active_project_count", "typical_project_scale", "sustainability_focus", "water_requirements", "existing_water_systems", "stp_experience", "rainwater_harvesting_experience", "wastewater_reuse_experience"]) {
    assert.ok(dev.includes(k), `developers: ${k}`);
  }
  const con = byProfile("contractors");
  for (const k of ["contractor_project_types", "contractor_specialties", "mep_water_involvement", "notable_projects", "water_systems_executed"]) assert.ok(con.includes(k), `contractors: ${k}`);
  assert.ok(!con.includes("building_types"));
  // Project facts have no organization profile.
  assert.ok(meta.factDefinitions.filter((d: { applies_to: string }) => d.applies_to === "project").every((d: { profiles: unknown }) => d.profiles === null));
  // Reference data only: no facts were created for any organization.
  assert.equal((await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM organization_facts`)).rows[0].n, 0);
});

test("organization facts API: add, change (history kept), withdraw; detail includes facts", async () => {
  const base = `/organizations/${ids.architect}/facts`;
  const a = await api.call("POST", base, { key: "influence_level", value: "medium", provenance: "Unverified", confidence: "Low", source: "Industry contact" });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.fact.value, "Medium");
  const c = await api.call("PATCH", `${base}/${a.body.fact.id}`, { value: "High", provenance: "Verified", confidence: "High" }, 2);
  assert.equal(c.status, 200);
  assert.deepEqual([c.body.fact.value, c.body.fact.provenance, c.body.fact.confidence, c.body.fact.replaces_fact_id, c.body.fact.source], ["High", "Verified", "High", a.body.fact.id, "Industry contact"]);
  await api.call("POST", base, { key: "stp_experience", value: true, provenance: "Verified" });
  const detail = (await api.call("GET", `/organizations/${ids.architect}`)).body;
  assert.deepEqual(detail.facts.map((f: { fact_key: string; value: string }) => `${f.fact_key}=${f.value}`).sort(), ["influence_level=High", "stp_experience=Yes"]);
  const hist = (await api.call("GET", `${base}?include_retired=1`)).body.filter((f: { fact_key: string }) => f.fact_key === "influence_level");
  assert.equal(hist.length, 2, "old version kept");
  const stp = detail.facts.find((f: { fact_key: string }) => f.fact_key === "stp_experience");
  assert.equal((await api.call("DELETE", `${base}/${stp.id}`)).status, 204);
  assert.equal((await api.call("DELETE", `${base}/${stp.id}`)).status, 404);
  assert.equal((await api.call("DELETE", `/organizations/${ids.hospital}/facts/${a.body.fact.id}`)).status, 404, "fact of another organization");
  assert.equal((await api.call("GET", "/organizations/999999/facts")).status, 404);
  assert.equal((await api.call("POST", base, { key: "water_requirement", value: 1, provenance: "Verified" })).status, 400, "project-only fact");
  const tl = (await api.call("GET", `/organizations/${ids.architect}`)).body.activities.map((x: { summary: string }) => x.summary);
  assert.ok(tl.includes("Changed Influence level: High (Verified, source: Industry contact)"));
  assert.ok(tl.includes("Withdrew STP experience: Yes"));
  // A hospital has no facts and nothing is inferred for it.
  assert.deepEqual((await api.call("GET", `/organizations/${ids.hospital}`)).body.facts, []);
});

test("project list rows carry stakeholder, water and CRM counts (single request, no N+1)", async () => {
  await api.call("POST", `/projects/${ids.p1}/stakeholders`, { organization_id: ids.developer, role: "Developer", is_primary: true, provenance: "Verified" });
  await api.call("POST", `/projects/${ids.p1}/stakeholders`, { organization_id: ids.architect, role: "Architect", provenance: "Verified" });
  await suggestWaterOpportunity(db(), { projectId: ids.p1, interventionType: "Greywater Reuse", reason: "Design stage, 640 units", agent: "test" });
  await api.call("POST", "/crm", { organization_id: ids.developer, project_id: ids.p1, opportunity_type: "Project Opportunity" });
  const rows = (await api.call("GET", "/projects")).body;
  const p1 = rows.find((r: { id: number }) => r.id === ids.p1);
  assert.deepEqual([p1.stakeholder_count, p1.water_opportunity_count, p1.crm_opportunity_count], [2, 1, 1]);
  assert.deepEqual(p1.stakeholders.map((s: { role: string }) => s.role), ["Developer", "Architect"]);
  const p2 = rows.find((r: { id: number }) => r.id === ids.p2);
  assert.deepEqual([p2.stakeholder_count, p2.water_opportunity_count, p2.crm_opportunity_count], [0, 0, 0]);
});

test("facets: areas and stakeholder organizations for the Projects filters", async () => {
  const f = (await api.call("GET", "/projects/facets")).body;
  assert.deepEqual(f.areas, ["Hebbal", "Thanisandra"]);
  assert.deepEqual(f.organizations.map((o: { name: string; project_count: number }) => `${o.name}:${o.project_count}`), ["Brigade Enterprises:1", "Mistry Architects:1"]);
});

test("organization detail lists projects with role, stage, area and water indicator, plus all opportunities", async () => {
  const d = (await api.call("GET", `/organizations/${ids.developer}`)).body;
  assert.equal(d.projects.length, 1);
  const p = d.projects[0];
  assert.deepEqual([p.project_name, p.role, p.is_primary, p.lifecycle_stage, p.project_area, p.water_opportunity_count], ["Brigade Lakeside Phase 1", "Developer", true, "Design", "Thanisandra", 1]);
  assert.equal(d.opportunities.length, 1);
  assert.equal(d.opportunities[0].pipeline, "project");
  assert.equal(d.opportunities[0].project_id, ids.p1);
});

test("project activity timeline: creation, edits, stakeholders, facts, CRM — newest first", async () => {
  await api.call("PATCH", `/projects/${ids.p1}`, { unit_count: 640 }, 2);
  const f = (await api.call("POST", `/projects/${ids.p1}/facts`, { key: "water_requirement", value: 420, provenance: "Unverified", source: "EIA" })).body.fact;
  await api.call("PATCH", `/projects/${ids.p1}/facts/${f.id}`, { value: 480 });
  const links = (await api.call("GET", `/projects/${ids.p1}/stakeholders`)).body;
  const arch = links.find((l: { role: string }) => l.role === "Architect");
  await api.call("PATCH", `/projects/${ids.p1}/stakeholders/${arch.id}`, { is_primary: true });
  await api.call("DELETE", `/projects/${ids.p1}/stakeholders/${arch.id}`, { reason: "Wrong firm" });
  const opp = (await api.call("GET", `/crm?project_id=${ids.p1}`)).body[0];
  await api.call("POST", `/crm/${opp.id}/interactions`, { type: "note", note: "Met the MEP team" });
  const act = (await api.call("GET", `/projects/${ids.p1}/activity`)).body;
  const summaries = act.map((a: { summary: string }) => a.summary);
  for (const re of [
    /^Project added \(Manual entry by Fayaas\)$/,
    /^Details updated by Akash: unit_count$/,
    /^Brigade Enterprises added as Developer \(primary\)/,
    /^Water requirement: 420 KLD \(Unverified, source: EIA\)$/,
    /^Changed Water requirement: 480 KLD/,
    /^Mistry Architects: Architect updated \(is_primary\)$/,
    /^Mistry Architects removed as Architect \(Wrong firm\)$/,
    // Phase 7: the CRM entry carries the project, so it appears once (no separate project copy).
    /^Brigade Enterprises: Added to CRM as Project Opportunity for project Brigade Lakeside Phase 1 by Fayaas$/,
    /^Brigade Enterprises: Note: Met the MEP team/,
  ]) {
    assert.ok(summaries.some((s: string) => re.test(s)), `missing ${re}\n${summaries.join("\n")}`);
  }
  const times = act.map((a: { occurred_at: string }) => Date.parse(a.occurred_at));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");
  assert.equal(new Set(act.map((a: { key: string }) => a.key)).size, act.length, "unique keys across both sources");
  assert.equal((await api.call("GET", "/projects/999999/activity")).status, 404);
  assert.deepEqual((await api.call("GET", `/projects/${ids.p2}/activity`)).body.map((a: { type: string }) => a.type), ["project_created"]);
});

test("existing saved views, Organizations filters and CRM keep working alongside projects", async () => {
  const names = async (qs: string) => (await api.call("GET", `/organizations${qs}`)).body.map((o: { name: string }) => o.name).sort();
  assert.deepEqual(await names("?view=architects"), ["Mistry Architects"]);
  assert.deepEqual(await names("?view=developers"), ["Brigade Enterprises", "Shapoorji Civil Works"]);
  assert.deepEqual(await names("?view=contractors"), ["Shapoorji Civil Works"]);
  assert.deepEqual(await names("?type=Hospital"), ["Lakeview Hospital"]);
  assert.equal((await api.call("GET", "/organizations")).body.length, 4, "no duplicate rows from project links or extra opportunities");
  const base = await api.call("POST", "/crm", { organization_id: ids.hospital });
  assert.equal(base.status, 201);
  assert.equal((await api.call("POST", `/crm/${base.body.id}/interactions`, { type: "contact_attempted" })).body.status, "Contacted");
  const board = (await api.call("GET", "/crm?pipeline=relationship")).body;
  assert.deepEqual(board.map((o: { organization_name: string }) => o.organization_name), ["Lakeview Hospital"]);
});

test("organization detail: the CRM panel's opportunity is relationship-only; project opportunities are listed separately", async () => {
  const org = (await api.call("POST", "/organizations", { data: { name: "Prestige Group", org_type: "Real Estate Developer" }, force: true })).body.id;
  await api.call("POST", `/projects/${ids.p2}/stakeholders`, { organization_id: org, role: "Developer", provenance: "Verified" });
  await api.call("POST", "/crm", { organization_id: org, project_id: ids.p2, opportunity_type: "Project Opportunity" });
  let d = (await api.call("GET", `/organizations/${org}`)).body;
  assert.equal(d.opportunity, null, "a project opportunity is not the organization's relationship opportunity");
  assert.equal(d.opportunities.length, 1);
  // Adding the organization to the CRM still works and becomes the panel's opportunity.
  const rel = await api.call("POST", "/crm", { organization_id: org });
  assert.equal(rel.status, 201);
  d = (await api.call("GET", `/organizations/${org}`)).body;
  assert.equal(d.opportunity.id, rel.body.id);
  assert.equal(d.opportunities.length, 2);
});
