import { test } from "node:test";
import assert from "node:assert/strict";
import type { Fact } from "../../shared/types";
import { confidenceFor, evaluateOrganization, evaluateProject, evidenceSignature, textMention, type OrganizationContext, type ProjectContext } from "./waterOpportunity";

// WSIS Phase 6: the water opportunity rules are pure functions over sourced facts.

let nextId = 1;
const fact = (fact_key: string, value: string, provenance: Fact["provenance"] = "Unverified", source: string | null = "Brochure", label = fact_key): Fact => ({
  id: nextId++, fact_key, label, value, note: null, source, provenance, confidence: "Medium", created_by_name: null, created_at: "", retired_at: null, replaces_fact_id: null,
});

const project = (p: Partial<ProjectContext["project"]> = {}, facts: Fact[] = []): ProjectContext => ({
  project: { id: 7, name: "Lakeside", project_type: null, lifecycle_stage: "Unknown", scale: "Unknown", built_up_area_sqft: null, building_count: null, unit_count: null, field_sources: {}, ...p },
  facts,
  units: { water_requirement: "KLD", wastewater_generation: "KLD", stp_capacity: "KLD" },
});
const rules = (ctx: ProjectContext) => evaluateProject(ctx).map((d) => d.rule_key).sort();

test("insufficient evidence generates no suggestion", () => {
  assert.deepEqual(evaluateProject(project()), [], "a bare project");
  assert.deepEqual(evaluateProject(project({ project_type: "Residential", lifecycle_stage: "Design" })), [], "type and stage alone are not evidence");
  assert.deepEqual(evaluateProject(project({ project_type: "Residential", unit_count: 40 })), [], "a small project");
});

test("large residential project with no water systems recorded → RWH and STP hypotheses citing the evidence", () => {
  const ctx = project({ project_type: "Residential", lifecycle_stage: "Design", unit_count: 640, field_sources: { unit_count: { provenance: "Unverified", source: "RERA filing" }, project_type: { provenance: "Verified", source: "Site visit" } } });
  const drafts = evaluateProject(ctx);
  assert.deepEqual(drafts.map((d) => d.rule_key).sort(), ["project.rainwater_harvesting", "project.stp"]);
  const rwh = drafts.find((d) => d.rule_key === "project.rainwater_harvesting")!;
  assert.equal(rwh.intervention, "Rainwater Harvesting");
  assert.match(rwh.reason, /Units: 640 \(Unverified, source: RERA filing\)/);
  assert.match(rwh.reason, /no sourced evidence of rainwater harvesting/);
  assert.match(rwh.reason, /may be worth investigating/);
  assert.doesNotMatch(rwh.reason, /\bneeds\b|\brequires\b/i, "a hypothesis, not a claim");
  assert.equal(rwh.confidence, "Medium", "the triggering unit count is Unverified");
  assert.ok(rwh.evidence_refs.some((r) => r.key === "unit_count" && r.source === "RERA filing"));
});

test("STP evidenced but no reuse → wastewater reuse hypothesis worded as in the brief", () => {
  const stp = fact("project_water_systems", "STP", "Verified", "EIA report", "Existing / planned water systems");
  const ctx = project({ project_type: "Residential", scale: "Large", field_sources: { scale: { provenance: "Verified", source: "Developer" } } }, [stp]);
  const reuse = evaluateProject(ctx).find((d) => d.rule_key === "project.sewage_reuse")!;
  assert.ok(reuse);
  assert.equal(reuse.intervention, "Sewage Reuse");
  assert.match(reuse.reason, /^Project is a Residential development with evidence of large scale \(Scale: Large \(Verified, source: Developer\)\) and has sourced evidence of an STP \(Existing \/ planned water systems: STP \(Verified, source: EIA report\)\), but no sourced evidence of wastewater reuse\. Wastewater reuse may therefore be worth investigating\.$/);
  assert.equal(reuse.confidence, "High", "the STP fact is Verified");
  assert.equal(reuse.evidence_refs[0].fact_id, stp.id, "the exact fact version is referenced");
  // With an STP recorded, no STP suggestion is made.
  assert.ok(!evaluateProject(ctx).some((d) => d.intervention === "STP"));
  // Once reuse is evidenced, the reuse hypothesis disappears.
  const withReuse = project(ctx.project, [stp, fact("project_water_systems", "Wastewater Reuse")]);
  assert.ok(!evaluateProject(withReuse).some((d) => d.rule_key === "project.sewage_reuse"));
});

test("groundwater, tanker, leaks and demand produce their own hypotheses; negated notes do not", () => {
  const ctx = project({ project_type: "Hospitality" }, [
    fact("water_sources", "Groundwater", "Verified", "Facility manager"),
    fact("water_sources", "Tanker", "Unverified", "Site visit"),
    fact("water_notes", "Frequent leaks reported in the basement lines", "Unverified", "Visit notes"),
    fact("water_requirement", "250", "Estimated", "Consultant"),
  ]);
  // 250 KLD demand is itself evidence of a large facility, so the scale-based hypotheses follow too.
  assert.deepEqual(rules(ctx), [
    "project.alternative_water_supply", "project.greywater_reuse", "project.groundwater_management", "project.leak_detection",
    "project.rainwater_harvesting", "project.smart_water_monitoring", "project.stp", "project.water_efficiency",
  ]);
  const leak = evaluateProject(ctx).find((d) => d.rule_key === "project.leak_detection")!;
  assert.equal(leak.confidence, "Medium", "free-text evidence caps at Medium");
  assert.match(leak.reason, /“?Frequent leaks reported/);
  assert.equal(textMention("No borewell on the site", /\bborewells?\b/i), "absent");
  assert.equal(textMention("Two borewells in use", /\bborewells?\b/i), "present");
  const negated = project({}, [fact("water_notes", "The site does not have a borewell", "Verified")]);
  assert.deepEqual(rules(negated), []);
});

test("AI-inferred facts are never used as triggers", () => {
  const ctx = project({ project_type: "Residential" }, [fact("water_sources", "Tanker", "AI Inference", null), fact("wastewater_generation", "400", "AI Inference", null)]);
  assert.deepEqual(evaluateProject(ctx), []);
});

test("confidence: all Verified → High; any Unverified/Estimated → Medium; inferred context → Low", () => {
  const ref = (provenance: "Verified" | "Unverified" | "Estimated") => ({ kind: "fact" as const, entity: "project" as const, entity_id: 1, key: "k", label: "k", value: "v", provenance, source: "s" });
  assert.equal(confidenceFor([ref("Verified"), ref("Verified")]), "High");
  assert.equal(confidenceFor([ref("Verified"), ref("Estimated")]), "Medium");
  assert.equal(confidenceFor([ref("Unverified")]), "Medium");
  assert.equal(confidenceFor([ref("Verified")], { textual: true }), "Medium");
  assert.equal(confidenceFor([ref("Verified")], { inferredContext: true }), "Low");
  assert.equal(confidenceFor([]), "Unknown");
});

test("rules are deterministic: same facts → same drafts and evidence signature", () => {
  const facts = [fact("water_sources", "Groundwater", "Verified"), fact("project_water_systems", "STP", "Verified")];
  const a = evaluateProject(project({ project_type: "Healthcare", scale: "Very large" }, facts));
  const b = evaluateProject(project({ project_type: "Healthcare", scale: "Very large" }, facts));
  assert.deepEqual(a, b);
  assert.equal(evidenceSignature(a[0].evidence_refs), evidenceSignature(b[0].evidence_refs));
  assert.notEqual(evidenceSignature(a[0].evidence_refs), evidenceSignature([{ ...a[0].evidence_refs[0], value: "changed" }]));
  assert.equal(new Set(a.map((d) => d.intervention)).size, a.length, "one draft per intervention");
});

/* ---------------- organizations ---------------- */

const org = (o: Partial<OrganizationContext["organization"]> = {}, rest: Partial<Omit<OrganizationContext, "organization">> = {}): OrganizationContext => ({
  organization: { id: 3, name: "X", org_type: "Hospital", group: "demand_side", field_sources: { org_type: { provenance: "Verified", source: "Visit" } }, water_info: [], ...o },
  facts: [],
  views: [],
  developerProjects: [],
  crmRelationship: null,
  ...rest,
});

test("organization: a hospital with nothing recorded gets nothing; with an STP note → reuse hypothesis", () => {
  assert.deepEqual(evaluateOrganization(org()), []);
  const d = evaluateOrganization(org({ water_info: [{ text: "Has a 200 KLD STP", provenance: "Verified", source: "Facility visit" }] }));
  assert.deepEqual(d.map((x) => x.rule_key).sort(), ["organization.sewage_reuse", "organization.water_efficiency"]);
  const reuse = d.find((x) => x.rule_key === "organization.sewage_reuse")!;
  assert.match(reuse.reason, /Hospital with sourced evidence of an STP \(Water information: “Has a 200 KLD STP” \(Verified, source: Facility visit\)\) but no sourced evidence of treated-water reuse/);
  // "No STP" is evidence of absence → STP hypothesis, not reuse.
  const none = evaluateOrganization(org({ water_info: [{ text: "There is no STP on campus", provenance: "Unverified", source: "Call" }] }));
  assert.deepEqual(none.map((x) => x.rule_key), ["organization.stp"]);
});

test("organization: inferred type caps confidence at Low and says so; AI water notes are ignored", () => {
  const d = evaluateOrganization(org({ field_sources: { org_type: { provenance: "AI Inference", source: null } }, water_info: [{ text: "Buys tankers daily", provenance: "Verified", source: "Call" }] }));
  assert.equal(d[0].confidence, "Low");
  assert.match(d[0].reason, /type inferred from name/);
  assert.deepEqual(evaluateOrganization(org({ water_info: [{ text: "Buys tankers daily", provenance: "AI Inference", source: null }] })), []);
});

test("organization: water-ecosystem vendors and built-environment firms get no facility-level hypotheses", () => {
  const notes = [{ text: "Installs STP and borewell systems", provenance: "Verified" as const, source: "Website" }];
  assert.deepEqual(evaluateOrganization(org({ org_type: "STP/WTP Provider", group: "water_ecosystem", water_info: notes })), []);
  assert.deepEqual(evaluateOrganization(org({ org_type: "Real Estate Developer", group: "built_environment", water_info: notes }, { views: ["developers"] })), []);
});

test("organization: architect with water-design evidence and influence → specification channel; developer with several projects → portfolio", () => {
  const arch = evaluateOrganization(
    org({ org_type: "Architect", group: "built_environment" }, { views: ["architects"], facts: [fact("water_conservation_experience", "Yes", "Verified", "Portfolio"), fact("influence_level", "High", "Unverified", "Industry contact")] }),
  );
  assert.deepEqual(arch.map((d) => [d.rule_key, d.intervention, d.potential, d.confidence]), [["organization.architect_specification", "Integrated Water Management", "High", "Medium"]]);
  assert.match(arch[0].reason, /Opportunities on specific projects are tracked on each project/);
  // Influence without design evidence → nothing.
  assert.deepEqual(evaluateOrganization(org({ org_type: "Architect", group: "built_environment" }, { views: ["architects"], facts: [fact("influence_level", "High")] })), []);

  const dev = evaluateOrganization(
    org({ org_type: "Real Estate Developer", group: "built_environment" }, {
      views: ["developers"],
      developerProjects: [
        { project_id: 1, project_name: "Lakeside 1", role: "Developer", provenance: "Verified", source: "RERA" },
        { project_id: 2, project_name: "Lakeside 2", role: "Developer", provenance: "Unverified", source: "News" },
      ],
      crmRelationship: { id: 9, status: "Contacted" },
    }),
  );
  assert.equal(dev[0].rule_key, "organization.developer_portfolio");
  assert.match(dev[0].reason, /2 projects/);
  assert.match(dev[0].reason, /not implied for the whole organization/);
  assert.match(dev[0].reason, /already in the CRM \(Contacted\)/, "existing CRM relationship is considered");
  assert.equal(evaluateOrganization(org({ org_type: "Real Estate Developer", group: "built_environment" }, { views: ["developers"], developerProjects: [{ project_id: 1, project_name: "A", role: "Developer", provenance: "Verified", source: null }] })).length, 0, "one project is not a portfolio");
});
