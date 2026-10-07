import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { ORG_TYPES } from "../../shared/constants";
import type { OrganizationTaxonomy } from "../../shared/types";
import { startTestApi, type TestApi } from "./helpers";

// WSIS Phase 3: database-backed organization types, saved Discover views, and type filtering
// through the existing Organizations API.

let api: TestApi;
const ids: Record<string, number> = {};

before(async () => {
  api = await startTestApi();
  const mk = async (key: string, data: Record<string, unknown>) => {
    const r = await api.call("POST", "/organizations", { data, force: true });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    ids[key] = r.body.id;
  };
  await mk("architect", { name: "Mistry Architects", org_type: "Architect", address: "Indiranagar, Bengaluru 560038", lat: 12.9719, lng: 77.6412 });
  await mk("firm", { name: "Studio Lotus Design", org_type: "Architecture Firm", address: "Koramangala, Bengaluru" });
  await mk("builder", { name: "Sobha Builders", org_type: "Builder", area: "Sarjapur" });
  await mk("developer", { name: "Brigade Enterprises", org_type: "Real Estate Developer", area: "Malleshwaram" });
  await mk("contractor", { name: "Shapoorji Civil Works", org_type: "Civil Contractor" });
  await mk("watertech", { name: "Aqua Smart Systems", org_type: "Water Technology Company", area: "Whitefield" });
  await mk("govt", { name: "BWSSB Head Office", org_type: "Government" });
  await mk("hospital", { name: "Sunrise Hospital", org_type: "Hospital", area: "Koramangala" });
  await mk("school", { name: "Greenwood School", org_type: "School", area: "Sarjapur" });
});
after(() => api.close());

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

test("GET /api/meta/organization-types returns the 34 seeded types with group, order, active state and map colour", async () => {
  const { status, body } = await api.call<OrganizationTaxonomy>("GET", "/meta/organization-types");
  assert.equal(status, 200);
  assert.equal(body.types.length, 34);
  const keys = body.types.map((t) => t.key);
  for (const t of ["Architect", "Architecture Firm", "Builder", "Real Estate Developer", "Water Technology Company"]) assert.ok(keys.includes(t), `${t} missing`);
  for (const t of ORG_TYPES) assert.ok(keys.includes(t), `original type ${t} missing`);
  const arch = body.types.find((t) => t.key === "Architect")!;
  assert.deepEqual(
    { label: arch.label, group: arch.group, group_label: arch.group_label, active: arch.active },
    { label: "Architect", group: "built_environment", group_label: "Built environment", active: true },
  );
  assert.match(arch.map_color!, /^#[0-9a-f]{6}$/i);
  assert.equal(typeof arch.sort_order, "number");
  // Deterministic order: by group order, then type order, then name.
  const groupOrder = new Map(body.groups.map((g) => [g.key, g.sort_order]));
  const sorted = [...body.types].sort((a, b) => groupOrder.get(a.group)! - groupOrder.get(b.group)! || a.sort_order - b.sort_order || a.label.localeCompare(b.label));
  assert.deepEqual(keys, sorted.map((t) => t.key));
  assert.equal(body.groups[0].key, "water_ecosystem");
  const again = await api.call<OrganizationTaxonomy>("GET", "/meta/organization-types");
  assert.deepEqual(again.body, body, "same response every time");
});

test("saved views come from the database with the agreed members", async () => {
  const { body } = await api.call<OrganizationTaxonomy>("GET", "/meta/organization-types");
  const v = Object.fromEntries(body.views.map((x) => [x.key, x]));
  assert.deepEqual(body.views.map((x) => x.label), ["Architects", "Developers", "Contractors", "Water Ecosystem"]);
  assert.deepEqual([...v.architects.types].sort(), ["Architect", "Architecture Firm"]);
  assert.deepEqual(
    [...v.developers.types].sort(),
    ["Builder", "Civil Contractor", "Construction Company", "Facility Management Company", "Green Building Consultant", "Interior Designer", "Landscape Architect", "MEP Consultant", "Plumbing Consultant", "Project Management Consultant", "Real Estate Developer", "Structural Consultant"],
  );
  assert.deepEqual([...v.contractors.types].sort(), ["Civil Contractor", "Construction Company"]);
  assert.deepEqual(
    [...v.water_ecosystem.types].sort(),
    ["Government", "NGO / Foundation", "Research Institution", "STP/WTP Provider", "Utility", "Wastewater Company", "Water Consultant", "Water Technology Company", "Water Treatment Company"],
  );
  // Every member is a real catalog type (also enforced by a foreign key).
  const typeKeys = new Set(body.types.map((t) => t.key));
  for (const view of body.views) for (const t of view.types) assert.ok(typeKeys.has(t), `${view.key}: ${t}`);
  // The full catalog response includes the views too.
  const meta = (await api.call("GET", "/meta")).body;
  assert.deepEqual(meta.organizationViews, body.views);
  await assert.rejects(db().query(`INSERT INTO organization_view_types (view_key, type_name) VALUES ('architects', 'Spaceport')`), /foreign key/);
});

test("architect organizations appear in the Organizations API with the right type and open in details", async () => {
  const list = (await api.call("GET", "/organizations")).body;
  const arch = list.find((o: { id: number }) => o.id === ids.architect);
  assert.equal(arch.org_type, "Architect");
  assert.ok(arch.lat && arch.lng, "located architect organizations are map-ready");
  const d = await api.call("GET", `/organizations/${ids.architect}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.organization.org_type, "Architect");
  assert.equal(d.body.organization.name, "Mistry Architects");
});

test("filtering by new types, multiple types and saved views", async () => {
  assert.deepEqual(names((await api.call("GET", "/organizations?type=Architect")).body), ["Mistry Architects"]);
  assert.deepEqual(names((await api.call("GET", `/organizations?type=${encodeURIComponent("Architect,Architecture Firm")}`)).body), ["Mistry Architects", "Studio Lotus Design"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?view=architects")).body), ["Mistry Architects", "Studio Lotus Design"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?view=developers")).body), ["Brigade Enterprises", "Shapoorji Civil Works", "Sobha Builders"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?view=contractors")).body), ["Shapoorji Civil Works"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?view=water_ecosystem")).body), ["Aqua Smart Systems", "BWSSB Head Office"]);
  const unknown = await api.call("GET", "/organizations?view=astronauts");
  assert.equal(unknown.status, 400);
});

test("a saved view combines with search, area, type and CRM filters", async () => {
  assert.deepEqual(names((await api.call("GET", "/organizations?view=architects&q=mistry")).body), ["Mistry Architects"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?view=developers&area=Sarjapur")).body), ["Sobha Builders"], "area filter narrows the view; the school in Sarjapur is excluded");
  assert.deepEqual(names((await api.call("GET", "/organizations?view=developers&type=Builder")).body), ["Sobha Builders"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?view=architects&type=Hospital")).body), [], "type outside the view → nothing");
  await api.call("POST", "/crm", { organization_id: ids.firm });
  assert.deepEqual(names((await api.call("GET", "/organizations?view=architects&crm=in")).body), ["Studio Lotus Design"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?view=architects&crm=out")).body), ["Mistry Architects"]);
});

test("original organization types and existing filters still work", async () => {
  assert.deepEqual(names((await api.call("GET", "/organizations?type=Hospital")).body), ["Sunrise Hospital"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?q=sunrise")).body), ["Sunrise Hospital"]);
  assert.deepEqual(names((await api.call("GET", "/organizations?area=Koramangala")).body), ["Studio Lotus Design", "Sunrise Hospital"]);
  assert.equal((await api.call("GET", "/organizations")).body.length, 9);
  const re = await api.call("PATCH", `/organizations/${ids.school}`, { org_type: "College / University" });
  assert.equal(re.body.org_type, "College / University");
  const back = await api.call("PATCH", `/organizations/${ids.architect}`, { org_type: "Architecture Firm" });
  assert.equal(back.body.org_type, "Architecture Firm");
  assert.equal((await api.call("PATCH", `/organizations/${ids.architect}`, { org_type: "Spaceport" })).status, 400);
});

test("clearing the type in the edit form stores Other labelled Unknown instead of failing", async () => {
  const r = await api.call("PATCH", `/organizations/${ids.hospital}`, { org_type: "" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.org_type, "Other");
  assert.deepEqual(r.body.field_sources.org_type, { provenance: "Unknown", source: null });
  const n = await api.call("PATCH", `/organizations/${ids.hospital}`, { org_type: null });
  assert.equal(n.status, 200);
});
