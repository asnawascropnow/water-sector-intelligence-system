import { test } from "node:test";
import assert from "node:assert/strict";
import type { Fact, FactDefinition, OrganizationTaxonomy, ProjectStakeholder } from "../../shared/types";
import {
  definitionsForOrganization,
  EMPTY_PROJECT_FILTERS,
  factHistory,
  formatFactValue,
  groupFacts,
  groupStakeholders,
  isFiltered,
  profilesForType,
  projectQuery,
  showsIntelligence,
} from "./projectUtils";

const taxonomy = {
  groups: [],
  types: [],
  views: [
    { key: "architects", label: "Architects", description: null, types: ["Architect", "Architecture Firm"] },
    { key: "developers", label: "Developers", description: null, types: ["Builder", "Civil Contractor"] },
    { key: "contractors", label: "Contractors", description: null, types: ["Civil Contractor"] },
  ],
} as OrganizationTaxonomy;
const def = (key: string, profiles: string[] | null, extra: Partial<FactDefinition> = {}) =>
  ({ key, label: key, applies_to: "organization", value_type: "text", allowed_values: null, multi_valued: false, type_groups: null, profiles, unit: null, description: null, ...extra }) as FactDefinition;
const defs = [def("building_types", ["architects"]), def("influence_level", ["architects", "developers"]), def("contractor_specialties", ["contractors"]), def("water_requirement", null, { applies_to: "project" })];
const fact = (id: number, key: string, value: string, extra: Partial<Fact> = {}) =>
  ({ id, fact_key: key, label: key, value, note: null, source: "s", provenance: "Unverified", confidence: "Medium", created_by_name: null, created_at: "", retired_at: null, replaces_fact_id: null, ...extra }) as Fact;

test("projectQuery builds server-side filter parameters", () => {
  assert.equal(projectQuery(EMPTY_PROJECT_FILTERS), "");
  assert.equal(projectQuery({ ...EMPTY_PROJECT_FILTERS, q: " lake ", stages: ["Design", "Tender"], type: "Residential", area: "Hebbal", organizationId: "7", role: "Architect" }), "?q=lake&stage=Design%2CTender&type=Residential&area=Hebbal&organization_id=7&role=Architect");
  assert.equal(isFiltered(EMPTY_PROJECT_FILTERS), false);
  assert.equal(isFiltered({ ...EMPTY_PROJECT_FILTERS, scale: "Large" }), true);
});

test("stakeholders are grouped by catalog role order, primary first", () => {
  const s = (id: number, role: string, name: string, is_primary = false) => ({ id, role, organization_name: name, is_primary }) as ProjectStakeholder;
  const g = groupStakeholders([s(1, "Contractor", "B Co"), s(2, "Architect", "Zeta"), s(3, "Architect", "Alpha"), s(4, "Developer", "Dev", true), s(5, "Architect", "Lead", true), s(6, "Custom role", "X")], ["Developer", "Architect", "Contractor"]);
  assert.deepEqual(g.map((x) => x.role), ["Developer", "Architect", "Contractor", "Custom role"]);
  assert.deepEqual(g[1].items.map((x) => x.organization_name), ["Lead", "Alpha", "Zeta"]);
});

test("intelligence profiles: architects see architect facts; a hospital sees none unless facts exist", () => {
  assert.deepEqual(profilesForType("Architect", taxonomy).map((p) => p.key), ["architects"]);
  assert.deepEqual(profilesForType("Civil Contractor", taxonomy).map((p) => p.key), ["developers", "contractors"]);
  assert.deepEqual(definitionsForOrganization(defs, ["architects"], []).map((d) => d.key), ["building_types", "influence_level"]);
  assert.deepEqual(definitionsForOrganization(defs, ["contractors"], []).map((d) => d.key), ["contractor_specialties"]);
  assert.equal(showsIntelligence("Architect", taxonomy, defs, []), true);
  assert.equal(showsIntelligence("Hospital", taxonomy, defs, []), false);
  // A recorded fact is still shown after a type change.
  assert.equal(showsIntelligence("Hospital", taxonomy, defs, [fact(1, "building_types", "Healthcare")]), true);
  assert.deepEqual(definitionsForOrganization(defs, [], [fact(1, "building_types", "Healthcare")]).map((d) => d.key), ["building_types"]);
});

test("facts grouped by definition; retired versions excluded; history follows replaces_fact_id", () => {
  const all = [fact(1, "influence_level", "Low", { retired_at: "x" }), fact(2, "influence_level", "Medium", { retired_at: "x", replaces_fact_id: 1 }), fact(3, "influence_level", "High", { replaces_fact_id: 2, provenance: "Verified" }), fact(4, "building_types", "Residential")];
  const g = groupFacts(all, defs);
  assert.deepEqual(g.map((x) => [x.def.key, x.facts.map((f) => f.value)]), [["building_types", ["Residential"]], ["influence_level", ["High"]]]);
  assert.deepEqual(factHistory(all[2], all).map((f) => f.value), ["Medium", "Low"]);
  assert.deepEqual(factHistory(all[3], all), []);
});

test("fact values are formatted with units, never invented", () => {
  assert.equal(formatFactValue("1200", { unit: "KLD", value_type: "number" }), "1,200 KLD");
  assert.equal(formatFactValue("Yes", { unit: null, value_type: "boolean" }), "Yes");
});
