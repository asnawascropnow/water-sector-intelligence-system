import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { startTestApi, type TestApi } from "./helpers";

// WSIS Phase 6: water intervention catalog, rule-based suggestions, human review, CRM conversion.

let api: TestApi;
const ids: Record<string, number> = {};
const AKASH = 2;
type W = { id: number; intervention_type: string; status: string; project_id: number | null; organization_id: number | null; reason: string; provenance: string; confidence: string; origin: string; evidence_refs: { fact_id?: number; key: string; value: string; superseded?: boolean }[]; evidence_current: boolean; organization_roles?: string[] };

const generate = (body: object, user?: number) => api.call("POST", "/water-opportunities/generate", body, user);
const listFor = async (projectId: number): Promise<W[]> => (await api.call("GET", `/water-opportunities?project_id=${projectId}`)).body;
const byType = (list: W[], t: string) => list.find((w) => w.intervention_type === t)!;

before(async () => {
  api = await startTestApi();
  const org = async (key: string, name: string, org_type: string) => {
    ids[key] = (await api.call("POST", "/organizations", { data: { name, org_type }, force: true })).body.id;
  };
  await org("developer", "Synthetic Developer Ltd", "Real Estate Developer");
  await org("architect", "Synthetic Architects", "Architect");
  await org("hospital", "Synthetic Hospital", "Hospital");
  await org("vendor", "Synthetic STP Vendor", "STP/WTP Provider");
  ids.p1 = (await api.call("POST", "/projects", { data: { name: "Synthetic Residences", project_type: "Residential", lifecycle_stage: "Design", unit_count: 640, lat: 13.05, lng: 77.6 } })).body.id;
  ids.p2 = (await api.call("POST", "/projects", { data: { name: "Synthetic Small Office", project_type: "Commercial" } })).body.id;
  await api.call("POST", `/projects/${ids.p1}/stakeholders`, { organization_id: ids.developer, role: "Developer", is_primary: true, provenance: "Verified" });
  await api.call("POST", `/projects/${ids.p1}/stakeholders`, { organization_id: ids.architect, role: "Architect", provenance: "Verified" });
  const stp = await api.call("POST", `/projects/${ids.p1}/facts`, { key: "project_water_systems", value: "STP", provenance: "Verified", source: "Synthetic EIA" });
  ids.stpFact = stp.body.fact.id;
});
after(() => api.close());

/* ---------------- catalog ---------------- */

test("intervention catalog: every required type, stable keys, groups, deterministic order", async () => {
  const a = (await api.call("GET", "/meta/water-interventions")).body as { key: string; label: string; group: string; group_label: string; sort_order: number; active: boolean }[];
  const b = (await api.call("GET", "/meta/water-interventions")).body;
  assert.deepEqual(a, b, "same order every time");
  const required = ["Rainwater Harvesting", "Water Treatment", "Wastewater Treatment", "STP", "Greywater Reuse", "Sewage Reuse", "Water Recycling", "Drinking Water Treatment", "Groundwater Management", "Stormwater Management", "Smart Water Monitoring", "Leak Detection", "Water Efficiency", "Landscaping Water Optimization"];
  for (const r of required) assert.ok(a.some((x) => x.label === r && x.active), r);
  assert.equal(new Set(a.map((x) => x.key)).size, a.length, "keys are unique");
  assert.equal(a.find((x) => x.label === "STP")!.key, "stp");
  assert.equal(a.find((x) => x.label === "Rainwater Harvesting")!.group_label, "Water sources & supply");
  const groups = a.map((x) => x.group);
  assert.deepEqual(groups, [...groups].sort((x, y) => ["supply", "treatment", "reuse", "efficiency", "integrated", "other"].indexOf(x) - ["supply", "treatment", "reuse", "efficiency", "integrated", "other"].indexOf(y)), "ordered by group");
  const meta = (await api.call("GET", "/meta")).body;
  assert.deepEqual(meta.waterInterventions.map((x: { label: string }) => x.label), a.filter((x) => x.active).map((x) => x.label));
  assert.ok(meta.waterInterventionTypes.includes("Sewage Reuse"), "the name list is kept for existing callers");
});

/* ---------------- generation + de-duplication ---------------- */

test("rule engine on a project: evidence-based suggestions, AI Inference, linked to the project, no duplicates", async () => {
  assert.equal((await generate({ project_id: ids.p2 })).body.created, 0, "a project with no evidence gets nothing");
  const r = await generate({ project_id: ids.p1 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const types = r.body.opportunities.map((w: W) => w.intervention_type).sort();
  assert.deepEqual(types, ["Rainwater Harvesting", "Sewage Reuse"], "STP is evidenced, so no STP suggestion — reuse instead");
  assert.equal(r.body.created, 2);
  for (const w of r.body.opportunities as W[]) {
    assert.deepEqual([w.status, w.provenance, w.origin, w.project_id, w.organization_id], ["suggested", "AI Inference", "ai", ids.p1, null]);
  }
  const reuse = byType(r.body.opportunities, "Sewage Reuse");
  assert.match(reuse.reason, /sourced evidence of an STP \(Existing \/ planned water systems: STP \(Verified, source: Synthetic EIA\)\), but no sourced evidence of wastewater reuse/);
  assert.equal(reuse.confidence, "High");
  assert.equal(reuse.evidence_refs[0].fact_id, ids.stpFact);

  const again = (await generate({ project_id: ids.p1 })).body;
  assert.deepEqual([again.created, again.unchanged, again.refreshed], [0, 2, 0], "a re-run refreshes instead of duplicating");
  assert.equal((await listFor(ids.p1)).length, 2);
  // The database also refuses a second live opportunity for the same target + intervention + context.
  await assert.rejects(
    db().query(`INSERT INTO water_opportunities (project_id, intervention_type, reason, provenance, origin) VALUES ($1, 'Sewage Reuse', 'x', 'AI Inference', 'ai')`, [ids.p1]),
    /duplicate key/,
  );
  // … but a genuinely different context (another tower) is a separate opportunity.
  await db().query(`INSERT INTO water_opportunities (project_id, intervention_type, context_key, reason, provenance, origin) VALUES ($1, 'Sewage Reuse', 'Tower B', 'x', 'AI Inference', 'ai')`, [ids.p1]);
  await db().query(`DELETE FROM water_opportunities WHERE context_key = 'Tower B'`);
  assert.equal((await generate({})).status, 400);
  assert.equal((await generate({ project_id: 999999 })).status, 404);
});

test("stakeholder organizations do not inherit project opportunities; Organization Details keeps them separate", async () => {
  const dev = (await api.call("GET", `/organizations/${ids.developer}`)).body;
  assert.deepEqual(dev.water_opportunities.organization, [], "nothing at organization level");
  assert.equal(dev.water_opportunities.projects.length, 2);
  for (const w of dev.water_opportunities.projects as W[]) {
    assert.equal(w.project_id, ids.p1);
    assert.equal(w.organization_id, null, "still the project's, not the developer's");
    assert.deepEqual(w.organization_roles, ["Developer"]);
  }
  assert.equal((await api.call("GET", `/water-opportunities?organization_id=${ids.developer}`)).body.length, 0);
  const hospital = (await api.call("GET", `/organizations/${ids.hospital}`)).body;
  assert.deepEqual(hospital.water_opportunities, { organization: [], projects: [] });
});

/* ---------------- review ---------------- */

test("approval workflow: review → approve; reject needs a reason and stays auditable; not resurfaced on the same evidence", async () => {
  const list = await listFor(ids.p1);
  const reuse = byType(list, "Sewage Reuse");
  const rwh = byType(list, "Rainwater Harvesting");
  const start = await api.call("POST", `/water-opportunities/${reuse.id}/review`, { decision: "start", owner_id: AKASH });
  assert.deepEqual([start.body.status, start.body.owner_name], ["needs_review", "Akash"]);
  assert.equal((await api.call("POST", `/water-opportunities/${reuse.id}/review`, { decision: "start" })).status, 409);
  const approved = await api.call("POST", `/water-opportunities/${reuse.id}/review`, { decision: "approve", note: "Developer confirmed STP output is discharged" }, AKASH);
  assert.equal(approved.status, 200);
  assert.deepEqual([approved.body.status, approved.body.reviewer_name, approved.body.provenance], ["approved", "Akash", "AI Inference"], "approved, but still labelled as an inference");
  assert.equal((await api.call("POST", `/water-opportunities/${reuse.id}/review`, { decision: "reject", note: "x" })).status, 409);

  assert.equal((await api.call("POST", `/water-opportunities/${rwh.id}/review`, { decision: "reject" })).status, 400, "a reason is required");
  const rejected = await api.call("POST", `/water-opportunities/${rwh.id}/review`, { decision: "reject", note: "RWH already built, not yet recorded" });
  assert.equal(rejected.body.status, "rejected");
  const detail = (await api.call("GET", `/water-opportunities/${rwh.id}`)).body;
  assert.deepEqual(detail.history.map((h: { action: string }) => h.action), ["suggest", "reject"]);
  assert.equal(detail.history[1].changes.note, "RWH already built, not yet recorded");
  assert.ok((await listFor(ids.p1)).some((w) => w.id === rwh.id && w.status === "rejected"), "rejected items are not deleted");

  const rerun = (await generate({ project_id: ids.p1 })).body;
  assert.deepEqual([rerun.created, rerun.kept, rerun.skipped_rejected], [0, 1, 1], "approved kept as decided; rejected not resurfaced");
  // Reconsidering a rejected suggestion puts it back into review.
  const back = await api.call("PATCH", `/water-opportunities/${rwh.id}`, { status: "needs_review", note: "Site visit shows no RWH" });
  assert.equal(back.body.status, "needs_review");
  await api.call("POST", `/water-opportunities/${rwh.id}/review`, { decision: "reject", note: "Confirmed: RWH exists" });
  // The database refuses a decision without a reviewer.
  await assert.rejects(db().query(`UPDATE water_opportunities SET status = 'approved', reviewed_by = NULL, reviewed_at = NULL WHERE id = $1`, [rwh.id]), /check constraint/);
  await assert.rejects(db().query(`UPDATE water_opportunities SET status = 'converted' WHERE id = $1`, [reuse.id]), /check constraint/, "converted needs a CRM link");
});

test("changing a source fact keeps the opportunity's evidence and history; withdrawn evidence flags open suggestions", async () => {
  const reuse = byType(await listFor(ids.p1), "Sewage Reuse");
  const changed = await api.call("PATCH", `/projects/${ids.p1}/facts/${ids.stpFact}`, { provenance: "Unverified", source: "Synthetic brochure" });
  assert.equal(changed.status, 200);
  const after = (await api.call("GET", `/water-opportunities/${reuse.id}`)).body;
  assert.equal(after.status, "approved");
  assert.equal(after.evidence_refs[0].fact_id, ids.stpFact, "still points at the version that was used");
  assert.equal(after.evidence_refs[0].superseded, true, "and says it has since changed");
  assert.match(after.reason, /Verified, source: Synthetic EIA/, "reason is not rewritten after approval");
  const facts = (await api.call("GET", `/projects/${ids.p1}/facts?include_retired=1`)).body;
  assert.ok(facts.some((f: { id: number; source: string }) => f.id === ids.stpFact && f.source === "Synthetic EIA"), "the fact's own source is untouched");

  // A suggestion on a second project, then its evidence is withdrawn.
  ids.p3 = (await api.call("POST", "/projects", { data: { name: "Synthetic Hotel", project_type: "Hospitality" } })).body.id;
  const gw = (await api.call("POST", `/projects/${ids.p3}/facts`, { key: "water_sources", value: "Groundwater", provenance: "Unverified", source: "Synthetic site visit" })).body.fact;
  const first = (await generate({ project_id: ids.p3 })).body;
  assert.deepEqual(first.opportunities.map((w: W) => w.intervention_type), ["Groundwater Management"]);
  await api.call("DELETE", `/projects/${ids.p3}/facts/${gw.id}`);
  const second = (await generate({ project_id: ids.p3 })).body;
  assert.equal(second.stale, 1);
  const w = second.opportunities[0] as W;
  assert.deepEqual([w.status, w.evidence_current], ["suggested", false], "flagged, not deleted");
  const tl = (await api.call("GET", `/projects/${ids.p3}/activity`)).body.map((a: { summary: string }) => a.summary);
  assert.ok(tl.some((s: string) => /no longer follows from current facts/.test(s)));
  assert.ok(tl.some((s: string) => /Water opportunity suggested \(AI Inference\): Groundwater Management/.test(s)));
});

/* ---------------- CRM conversion ---------------- */

test("approved project opportunity → Project Opportunity pipeline with the chosen stakeholder; duplicates prevented", async () => {
  const reuse = byType(await listFor(ids.p1), "Sewage Reuse");
  const url = `/water-opportunities/${reuse.id}/convert`;
  assert.equal((await api.call("POST", url, {})).status, 400, "the stakeholder must be chosen");
  assert.equal((await api.call("POST", url, { organization_id: ids.hospital })).status, 400, "not a stakeholder on the project");
  assert.equal((await api.call("POST", url, { organization_id: ids.developer, opportunity_type: "Customer" })).status, 400, "relationship type on a project opportunity");
  const crmBefore = (await api.call("GET", "/crm")).body.length;
  const r = await api.call("POST", url, { organization_id: ids.developer, owner_id: AKASH });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const c = r.body.crm_opportunity;
  assert.deepEqual([c.pipeline, c.opportunity_type, c.project_id, c.organization_id, c.status, c.owner_id], ["project", "Project Opportunity", ids.p1, ids.developer, "Identified", AKASH]);
  assert.equal(c.title, "Sewage Reuse — Synthetic Residences");
  assert.deepEqual([r.body.water_opportunity.status, r.body.water_opportunity.crm_opportunity_id, r.body.water_opportunity.crm_pipeline], ["converted", c.id, "project"]);
  assert.equal((await api.call("GET", "/crm")).body.length, crmBefore + 1, "exactly one CRM record, created by the person's action");
  assert.equal((await api.call("POST", url, { organization_id: ids.developer })).status, 409, "no double conversion");

  // A second approved opportunity on the same project + developer: creating would duplicate the open CRM opportunity → link it instead.
  const m = await api.call("POST", "/water-opportunities", { project_id: ids.p1, intervention_type: "Smart Water Monitoring", reason: "Developer asked about metering", provenance: "Verified" });
  assert.equal(m.status, 201);
  assert.equal(m.body.status, "approved", "a person's own entry is approved on entry");
  const dup = await api.call("POST", `/water-opportunities/${m.body.id}/convert`, { organization_id: ids.developer });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.opportunity_id, c.id);
  const link = await api.call("POST", `/water-opportunities/${m.body.id}/convert`, { crm_opportunity_id: c.id });
  assert.equal(link.status, 200);
  assert.deepEqual([link.body.created, link.body.water_opportunity.status], [false, "converted"]);
  const tl = (await api.call("GET", `/projects/${ids.p1}/activity`)).body.map((a: { summary: string }) => a.summary);
  assert.ok(tl.some((s: string) => /Sewage Reuse opportunity converted to a new CRM opportunity with Synthetic Developer Ltd \(Project Opportunity pipeline\)/.test(s)));
  // Suggestions cannot be converted.
  const p3 = (await listFor(ids.p3))[0];
  assert.equal((await api.call("POST", `/water-opportunities/${p3.id}/convert`, { organization_id: ids.developer })).status, 409);
});

test("organization-level opportunity: generated from the organization's own evidence, converts to the relationship pipeline", async () => {
  await api.call("POST", `/organizations/${ids.hospital}/water-info`, { text: "Runs a 150 KLD STP; treated water is discharged", provenance: "Verified", source: "Synthetic facility visit" });
  await api.call("POST", `/organizations/${ids.vendor}/water-info`, { text: "Supplies STP and borewell systems", provenance: "Verified", source: "Website" });
  assert.equal((await generate({ organization_id: ids.vendor })).body.created, 0, "a water vendor's offering is not a need");
  const g = (await generate({ organization_id: ids.hospital })).body;
  const types = g.opportunities.map((w: W) => w.intervention_type).sort();
  assert.deepEqual(types, ["Sewage Reuse", "Water Efficiency"]);
  const reuse = byType(g.opportunities, "Sewage Reuse");
  assert.deepEqual([reuse.organization_id, reuse.project_id], [ids.hospital, null]);
  const detail = (await api.call("GET", `/organizations/${ids.hospital}`)).body;
  assert.equal(detail.water_opportunities.organization.length, 2);
  assert.deepEqual(detail.water_opportunities.projects, [], "organization-level and project opportunities are separate lists");

  await api.call("POST", `/water-opportunities/${reuse.id}/review`, { decision: "approve" });
  assert.equal((await api.call("POST", `/water-opportunities/${reuse.id}/convert`, { organization_id: ids.developer })).status, 400, "converts for that organization only");
  const r = await api.call("POST", `/water-opportunities/${reuse.id}/convert`, {});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.crm_opportunity.pipeline, r.body.crm_opportunity.opportunity_type, r.body.crm_opportunity.project_id, r.body.crm_opportunity.status], ["relationship", "Customer", null, "New"]);
  assert.equal((await api.call("POST", `/water-opportunities/${reuse.id}/convert`, {})).status, 409);

  // Close with an outcome, then reopen.
  assert.equal((await api.call("PATCH", `/water-opportunities/${reuse.id}`, { status: "closed" })).status, 400, "outcome required");
  const closed = await api.call("PATCH", `/water-opportunities/${reuse.id}`, { status: "closed", outcome: "lost", note: "Budget moved" });
  assert.deepEqual([closed.body.status, closed.body.outcome], ["closed", "lost"]);
  const reopened = await api.call("PATCH", `/water-opportunities/${reuse.id}`, { status: "approved" });
  assert.deepEqual([reopened.body.status, reopened.body.outcome, reopened.body.crm_opportunity_id], ["converted", null, r.body.crm_opportunity.id]);
});

/* ---------------- dashboard, brief, recommendations, map ---------------- */

test("dashboard and daily brief expose real water counts; recommendations follow the review state; existing counts unchanged", async () => {
  const summary = (await api.call("GET", "/dashboard/summary")).body;
  for (const k of ["totalOrganizations", "newOrganizations", "crmOpportunities", "activeOpportunities", "proposalsSent", "pilots", "overdueFollowUps", "pipeline"]) assert.ok(k in summary, k);
  const live = (await db().query<{ n: number }>(`SELECT count(*)::int AS n FROM water_opportunities WHERE status IN ('suggested','needs_review')`)).rows[0].n;
  assert.equal(summary.water.toReview, live);
  assert.equal(summary.water.projectAwaitingNextAction, 0, "both approved project opportunities are converted");

  const brief = (await api.call("GET", "/ai/daily-brief")).body;
  assert.equal(brief.water.toReview, live);
  assert.ok("followUpsDue" in brief.counts && !("water" in brief.counts), "existing count keys unchanged");
  const review = brief.recommendations.find((r: { action_type: string; payload: { project_id?: number } }) => r.action_type === "review_water_suggestions" && r.payload.project_id === ids.p3);
  assert.ok(review, "suggestions waiting for review are surfaced");
  assert.match(review.reason, /AI Inference/);
  const hosp = brief.recommendations.find((r: { action_type: string; organization_id: number }) => r.action_type === "review_water_suggestions" && r.organization_id === ids.hospital);
  assert.ok(hosp);

  // An approved, unconverted project opportunity → "decide next step", naming stakeholders without assigning the opportunity to them.
  const m = (await api.call("POST", "/water-opportunities", { project_id: ids.p1, intervention_type: "Leak Detection", reason: "Facility team reported losses", provenance: "Unverified", source: "Synthetic call" })).body;
  const recs = (await api.call("GET", "/ai/recommendations")).body;
  const next = recs.find((r: { action_type: string; payload: { water_opportunity_id?: number } }) => r.action_type === "convert_water_opportunity" && r.payload.water_opportunity_id === m.id);
  assert.ok(next);
  assert.match(next.reason, /Developer: Synthetic Developer Ltd; Architect: Synthetic Architects/);
  assert.equal(next.organization_id, null, "attached to the project, not to a stakeholder");
  await api.call("PATCH", `/water-opportunities/${m.id}`, { status: "closed", outcome: "not_pursued" });
  const recs2 = (await api.call("GET", "/ai/recommendations")).body;
  assert.ok(!recs2.some((r: { payload: { water_opportunity_id?: number } }) => r.payload.water_opportunity_id === m.id), "resolves when the condition clears");

  const map = (await api.call("GET", "/water-opportunities/map")).body;
  assert.ok(map.length >= 1);
  assert.ok(map.every((x: { status: string; lat: number }) => ["approved", "converted"].includes(x.status) && typeof x.lat === "number"), "only trusted, located opportunities");
});

test("assigning an owner and changing potential are logged; unknown statuses are refused", async () => {
  const w = (await listFor(ids.p3))[0];
  const r = await api.call("PATCH", `/water-opportunities/${w.id}`, { owner_id: AKASH, potential: "High" });
  assert.deepEqual([r.body.owner_name, r.body.potential], ["Akash", "High"]);
  assert.equal((await api.call("PATCH", `/water-opportunities/${w.id}`, { status: "won" })).status, 400);
  assert.equal((await api.call("PATCH", `/water-opportunities/${w.id}`, { status: "closed", outcome: "won" })).status, 409, "a suggestion cannot be closed before review");
  assert.equal((await api.call("PATCH", `/water-opportunities/${w.id}`, { status: "rejected" })).status, 400, "rejecting needs a reason");
  const h = (await api.call("GET", `/water-opportunities/${w.id}`)).body.history.map((x: { action: string }) => x.action);
  assert.ok(h.includes("update"));
  assert.equal((await api.call("GET", "/water-opportunities/999999")).status, 404);
});
