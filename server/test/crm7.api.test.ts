import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { todayIST } from "../lib/time";
import { startTestApi, type TestApi } from "./helpers";

// WSIS Phase 7: CRM for both pipelines — relationship and project opportunities as distinct, first-class records.

let api: TestApi;
const ids: Record<string, number> = {};
const AKASH = 2;
type Opp = { id: number; pipeline: string; status: string; project_id: number | null; project_name: string | null; organization_id: number; title: string | null; opportunity_type: string; stakeholder_roles: string[] | null; interventions: string[] | null; potential: string | null; potential_source: string | null; stage_kind: string; source_water_opportunity_id: number | null };

before(async () => {
  api = await startTestApi();
  const org = async (key: string, name: string, org_type: string) => {
    ids[key] = (await api.call("POST", "/organizations", { data: { name, org_type }, force: true })).body.id;
  };
  await org("architect", "Synthetic Mistry Architects", "Architect");
  await org("developer", "Synthetic Prestige Group", "Real Estate Developer");
  await org("mep", "Synthetic MEP Consultants", "MEP Consultant");
  await org("hospital", "Synthetic Hospital", "Hospital");
  ids.px = (await api.call("POST", "/projects", { data: { name: "Synthetic Project X", project_type: "Residential", lifecycle_stage: "Design", lat: 13.01, lng: 77.6 }, force: true })).body.id;
  ids.py = (await api.call("POST", "/projects", { data: { name: "Synthetic Project Y", project_type: "Commercial", lifecycle_stage: "Construction" }, force: true })).body.id;
  for (const [p, o, role] of [[ids.px, ids.architect, "Architect"], [ids.px, ids.developer, "Developer"], [ids.px, ids.mep, "MEP Consultant"], [ids.py, ids.architect, "Architect"]] as const) {
    await api.call("POST", `/projects/${p}/stakeholders`, { organization_id: o, role, provenance: "Verified" });
  }
  await api.call("POST", `/organizations/${ids.architect}/contacts`, { name: "Synthetic R. Mistry", designation: "Principal" });
});
after(() => api.close());

/* ---------------- pipelines ---------------- */

test("both pipelines load from the catalog with ordered stages and outcomes", async () => {
  const meta = (await api.call("GET", "/meta")).body;
  const p = (k: string) => meta.pipelines.find((x: { key: string }) => x.key === k);
  const names = (k: string, outcome: boolean) => p(k).stages.filter((s: { is_outcome: boolean }) => s.is_outcome === outcome).map((s: { name: string }) => s.name);
  assert.deepEqual(names("relationship", false), ["New", "Contacted", "Call", "Proposal Sent", "Follow-up", "Pilot", "Converted"]);
  assert.deepEqual(names("relationship", true), ["Not Interested", "Lost", "Nurture"]);
  assert.deepEqual(names("project", false), ["Identified", "Research", "Contacted", "Meeting", "Technical Discussion", "Proposal", "Negotiation", "Pilot / Project", "Won"]);
  assert.deepEqual(names("project", true), ["Lost", "Nurture"]);
  for (const k of ["relationship", "project"]) {
    const orders = p(k).stages.map((s: { sort_order: number }) => s.sort_order);
    assert.deepEqual(orders, [...orders].sort((a: number, b: number) => a - b), `${k} stages ordered`);
  }
  assert.equal(p("project").stages.find((s: { name: string }) => s.name === "Lost").kind, "lost");
});

/* ---------------- creation & many opportunities per organization ---------------- */

test("one organization holds distinct relationship and project opportunities; project ones need a project and a stakeholder customer", async () => {
  const relA = await api.call("POST", "/crm", { organization_id: ids.architect, owner_id: AKASH });
  const relB = await api.call("POST", "/crm", { organization_id: ids.architect, opportunity_type: "Architect Partner", title: "Specification partnership", potential: "High" });
  const projA = await api.call("POST", "/crm", { organization_id: ids.architect, project_id: ids.px, opportunity_type: "Project Opportunity", title: "Water Management — Project X", potential: "Medium", owner_id: AKASH, status: "Research" });
  const projB = await api.call("POST", "/crm", { organization_id: ids.architect, project_id: ids.py, opportunity_type: "Project Opportunity" });
  for (const r of [relA, relB, projA, projB]) assert.equal(r.status, 201, JSON.stringify(r.body));
  Object.assign(ids, { relA: relA.body.id, relB: relB.body.id, projA: projA.body.id, projB: projB.body.id });
  assert.deepEqual([projA.body.pipeline, projA.body.status, projA.body.project_name, projA.body.stakeholder_roles, projA.body.potential, projA.body.potential_source], ["project", "Research", "Synthetic Project X", ["Architect"], "Medium", "team"]);
  assert.deepEqual([relB.body.pipeline, relB.body.opportunity_type, relB.body.potential_source], ["relationship", "Architect Partner", "team"]);

  // Validation: no project, a non-stakeholder customer, a relationship type in the project pipeline, a project stage in the relationship pipeline.
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.hospital, pipeline: "project", opportunity_type: "Project Opportunity" })).status, 400);
  const notStakeholder = await api.call("POST", "/crm", { organization_id: ids.hospital, project_id: ids.px, opportunity_type: "Project Opportunity" });
  assert.equal(notStakeholder.status, 400);
  assert.match(notStakeholder.body.error, /stakeholder/);
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.developer, project_id: ids.px, pipeline: "project", opportunity_type: "Customer" })).status, 400);
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.hospital, status: "Identified" })).status, 400);
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.hospital, potential: "Huge" })).status, 400);
  // Duplicate rules unchanged: a second open relationship of the same type, or project opportunity on the same project.
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.architect })).status, 409);
  assert.equal((await api.call("POST", "/crm", { organization_id: ids.architect, project_id: ids.px, opportunity_type: "Project Opportunity" })).status, 409);

  // Boards and the organization view keep them apart.
  const rel = (await api.call("GET", `/crm?pipeline=relationship&organization_id=${ids.architect}`)).body as Opp[];
  const proj = (await api.call("GET", `/crm?pipeline=project&organization_id=${ids.architect}`)).body as Opp[];
  assert.deepEqual(rel.map((o) => o.id).sort(), [ids.relA, ids.relB].sort());
  assert.deepEqual(proj.map((o) => o.id).sort(), [ids.projA, ids.projB].sort());
  const detail = (await api.call("GET", `/organizations/${ids.architect}`)).body;
  assert.equal(detail.opportunity.id, ids.relA, "the CRM panel shows the organization's own relationship");
  assert.equal(detail.opportunities.length, 4);
  const listed = (await api.call("GET", "/organizations?crm=in")).body.find((o: { id: number }) => o.id === ids.architect);
  assert.deepEqual([listed.crm_status, listed.crm_opportunity_count, listed.project_opportunity_count], ["New", 4, 2]);
});

test("an organization with only project opportunities has no relationship status", async () => {
  const r = await api.call("POST", "/crm", { organization_id: ids.developer, project_id: ids.px, opportunity_type: "Project Opportunity", owner_id: AKASH });
  assert.equal(r.status, 201);
  ids.devProj = r.body.id;
  const d = (await api.call("GET", `/organizations/${ids.developer}`)).body;
  assert.equal(d.opportunity, null);
  const listed = (await api.call("GET", "/organizations?crm=in")).body.find((o: { id: number }) => o.id === ids.developer);
  assert.deepEqual([listed.crm_status, listed.project_opportunity_count], [null, 1], "in CRM, but not as a relationship");
  assert.ok(!(await api.call("GET", "/organizations?crm=relationship")).body.some((o: { id: number }) => o.id === ids.developer));
});

/* ---------------- detail ---------------- */

test("opportunity detail: project opportunity with stakeholders and stages; organization-only opportunity without a project", async () => {
  const p = (await api.call("GET", `/crm/${ids.projA}`)).body;
  assert.equal(p.opportunity.id, ids.projA);
  assert.deepEqual(p.stages.map((s: { name: string }) => s.name).slice(0, 3), ["Identified", "Research", "Contacted"]);
  assert.equal(p.project.name, "Synthetic Project X");
  assert.deepEqual(p.stakeholders.map((s: { organization_name: string; role: string }) => `${s.role}:${s.organization_name}`).sort(), [
    "Architect:Synthetic Mistry Architects", "Developer:Synthetic Prestige Group", "MEP Consultant:Synthetic MEP Consultants",
  ]);
  assert.equal(p.contacts[0].name, "Synthetic R. Mistry");
  assert.deepEqual(p.other_opportunities.map((o: Opp) => o.id).sort(), [ids.relA, ids.relB, ids.projB].sort(), "relationship context");
  const r = (await api.call("GET", `/crm/${ids.relA}`)).body;
  assert.deepEqual([r.project, r.stakeholders, r.stages[0].name], [null, [], "New"]);
  assert.equal((await api.call("GET", "/crm/999999")).status, 404);
});

/* ---------------- stages ---------------- */

test("stage movement in both pipelines: forward, backward, explicit; validated against the opportunity's own pipeline; logged", async () => {
  const step = (id: number, s: 1 | -1) => api.call("PATCH", `/crm/${id}`, { stage_step: s });
  assert.equal((await step(ids.projA, 1)).body.status, "Contacted");
  assert.equal((await step(ids.projA, 1)).body.status, "Meeting");
  assert.equal((await step(ids.projA, -1)).body.status, "Contacted", "a person may move back");
  assert.equal((await api.call("PATCH", `/crm/${ids.projA}`, { status: "Technical Discussion" })).body.status, "Technical Discussion");
  const bad = await api.call("PATCH", `/crm/${ids.projA}`, { status: "Proposal Sent" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /not a stage of the Project Opportunity pipeline/);
  assert.equal((await api.call("PATCH", `/crm/${ids.relA}`, { status: "Technical Discussion" })).status, 400);
  assert.equal((await step(ids.relA, -1)).status, 409, "already at the first stage");

  // Relationship pipeline still auto-advances exactly as before; project interactions use the project's milestones.
  assert.equal((await api.call("POST", `/crm/${ids.relA}/interactions`, { type: "call_completed" })).body.status, "Call");
  const m = await api.call("POST", `/crm/${ids.projB}/interactions`, { type: "call_completed", note: "Intro call" });
  assert.equal(m.body.status, "Contacted", "no 'Call' stage in the project pipeline");
  assert.equal((await api.call("POST", `/crm/${ids.projB}/interactions`, { type: "meeting_held" })).body.status, "Meeting");
  assert.equal((await api.call("POST", `/crm/${ids.projB}/interactions`, { type: "proposal_sent" })).body.status, "Proposal");
  assert.equal((await api.call("PATCH", `/crm/${ids.projB}`, { pilot_status: "In Progress" })).body.status, "Pilot / Project");
  const won = await api.call("PATCH", `/crm/${ids.projB}`, { status: "Won", status_reason: "Order received" });
  assert.deepEqual([won.body.status, won.body.stage_kind], ["Won", "won"]);
  assert.equal((await step(ids.projB, 1)).status, 409);

  const acts = (await api.call("GET", `/crm/${ids.projA}`)).body.activities.filter((a: { type: string }) => a.type === "status_change");
  assert.deepEqual(acts.map((a: { summary: string }) => a.summary).reverse(), [
    "Status changed: Research → Contacted", "Status changed: Contacted → Meeting", "Status changed: Meeting → Contacted", "Status changed: Contacted → Technical Discussion",
  ]);
  assert.ok(acts.every((a: { details: { pipeline: string } }) => a.details.pipeline === "project"));
  const autos = (await api.call("GET", `/crm/${ids.projB}`)).body.activities.filter((a: { type: string; details: { automatic?: boolean } }) => a.type === "status_change" && a.details.automatic);
  assert.ok(autos.some((a: { summary: string }) => a.summary === "Status changed: Proposal → Pilot / Project"), "automatic moves are logged too");
});

/* ---------------- tasks & activity ---------------- */

test("tasks link to an opportunity (organization and project derived), a project, or an organization", async () => {
  const t1 = await api.call("POST", "/tasks", { opportunity_id: ids.projA, title: "Send STP layout questions", due_date: todayIST() });
  assert.equal(t1.status, 201, JSON.stringify(t1.body));
  assert.deepEqual([t1.body.opportunity_id, t1.body.organization_id, t1.body.project_id, t1.body.project_name, t1.body.opportunity_pipeline], [ids.projA, ids.architect, ids.px, "Synthetic Project X", "project"]);
  const t2 = await api.call("POST", "/tasks", { opportunity_id: ids.relB, title: "Share specification deck" });
  assert.deepEqual([t2.body.opportunity_id, t2.body.project_id, t2.body.opportunity_type], [ids.relB, null, "Architect Partner"]);
  // Organization-only (the existing flow): attaches to its relationship opportunity — never to a project opportunity.
  const t3 = await api.call("POST", "/tasks", { organization_id: ids.architect, title: "Call the principal" });
  assert.deepEqual([t3.body.opportunity_id, t3.body.project_id], [ids.relA, null]);
  const t4 = await api.call("POST", "/tasks", { organization_id: ids.developer, title: "Intro email" });
  assert.deepEqual([t4.body.opportunity_id, t4.body.organization_id], [null, ids.developer], "developer has only a project opportunity");
  const t5 = await api.call("POST", "/tasks", { project_id: ids.py, title: "Find the MEP consultant" });
  assert.deepEqual([t5.body.project_id, t5.body.opportunity_id, t5.body.organization_id], [ids.py, null, null]);
  assert.equal((await api.call("POST", "/tasks", { opportunity_id: ids.projA, project_id: ids.py, title: "x" })).status, 400);
  assert.equal((await api.call("POST", "/tasks", { opportunity_id: 999999, title: "x" })).status, 404);
  const byProject = (await api.call("GET", `/tasks?project_id=${ids.px}`)).body.map((t: { title: string }) => t.title);
  assert.deepEqual(byProject, ["Send STP layout questions"]);
  assert.equal((await api.call("GET", `/crm/${ids.projA}`)).body.opportunity.next_task_title, "Send STP layout questions");
  assert.equal((await api.call("GET", `/crm/${ids.projA}`)).body.tasks.length, 1);
});

test("activity on a project opportunity: one record, on the opportunity, project and organization timelines", async () => {
  await api.call("POST", `/crm/${ids.projA}/interactions`, { type: "note", note: "MEP team prefers MBBR STP" });
  const opp = (await api.call("GET", `/crm/${ids.projA}`)).body.activities.filter((a: { summary: string }) => /MBBR/.test(a.summary));
  const proj = (await api.call("GET", `/projects/${ids.px}/activity`)).body.filter((a: { summary: string }) => /MBBR/.test(a.summary));
  const org = (await api.call("GET", `/organizations/${ids.architect}`)).body.activities.filter((a: { summary: string }) => /MBBR/.test(a.summary));
  assert.equal(opp.length, 1);
  assert.equal(proj.length, 1, "not duplicated on the project");
  assert.equal(proj[0].summary, "Synthetic Mistry Architects: Note: MEP team prefers MBBR STP — by Fayaas", "organization context kept");
  assert.equal(org.length, 1);
  assert.equal(org[0].opportunity_id, ids.projA);
  assert.equal((await db().query(`SELECT project_id FROM activities WHERE id = $1`, [org[0].id])).rows[0].project_id, ids.px);
  // A relationship interaction does not appear on any project timeline.
  await api.call("POST", `/crm/${ids.relA}/interactions`, { type: "note", note: "Relationship-only note" });
  assert.ok(!(await api.call("GET", `/projects/${ids.px}/activity`)).body.some((a: { summary: string }) => /Relationship-only/.test(a.summary)));
});

/* ---------------- water conversion ---------------- */

test("converted water opportunities: CRM record keeps the link back and shows the intervention; no duplicate conversion", async () => {
  const w = await api.call("POST", "/water-opportunities", { project_id: ids.px, intervention_type: "Sewage Reuse", reason: "Synthetic: STP evidenced, no reuse", provenance: "Verified" });
  const c = await api.call("POST", `/water-opportunities/${w.body.id}/convert`, { organization_id: ids.mep });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const crm = (await api.call("GET", `/crm/${c.body.crm_opportunity.id}`)).body;
  assert.deepEqual([crm.opportunity.pipeline, crm.opportunity.project_id, crm.opportunity.source_water_opportunity_id, crm.opportunity.interventions], ["project", ids.px, w.body.id, ["Sewage Reuse"]]);
  assert.deepEqual(crm.water_opportunities.map((x: { id: number }) => x.id), [w.body.id]);
  assert.equal((await api.call("POST", `/water-opportunities/${w.body.id}/convert`, { organization_id: ids.mep })).status, 409);
  const o = await api.call("POST", "/water-opportunities", { organization_id: ids.hospital, intervention_type: "Leak Detection", reason: "Synthetic: losses reported", provenance: "Unverified", source: "Synthetic call" });
  const oc = await api.call("POST", `/water-opportunities/${o.body.id}/convert`, {});
  assert.deepEqual([oc.body.crm_opportunity.pipeline, oc.body.crm_opportunity.project_id, oc.body.crm_opportunity.source_water_opportunity_id], ["relationship", null, o.body.id]);
  // Searchable by intervention, filterable by intervention and lifecycle.
  assert.deepEqual((await api.call("GET", "/crm?q=sewage")).body.map((x: Opp) => x.id), [c.body.crm_opportunity.id]);
  assert.deepEqual((await api.call("GET", "/crm?pipeline=project&intervention=Sewage%20Reuse&lifecycle=Design")).body.map((x: Opp) => x.id), [c.body.crm_opportunity.id]);
  assert.deepEqual((await api.call("GET", "/crm?pipeline=project&intervention=Sewage%20Reuse&lifecycle=Construction")).body, []);
  ids.mepProj = c.body.crm_opportunity.id;
});

/* ---------------- search & filters ---------------- */

test("server-side search and combinable filters", async () => {
  const ids_ = async (qs: string) => ((await api.call("GET", `/crm${qs}`)).body as Opp[]).map((o) => o.id).sort();
  assert.deepEqual(await ids_("?q=project%20x&pipeline=project"), [ids.projA, ids.devProj, ids.mepProj].sort(), "project name");
  assert.deepEqual(await ids_("?q=specification"), [ids.relB], "title");
  assert.ok((await ids_("?q=r.%20mistry")).includes(ids.relA), "contact person");
  assert.deepEqual(await ids_(`?pipeline=project&owner=${AKASH}&potential=Medium`), [ids.projA]);
  assert.deepEqual(await ids_(`?pipeline=project&project_id=${ids.py}`), [ids.projB]);
  assert.deepEqual(await ids_("?pipeline=relationship&type=Architect%20Partner"), [ids.relB]);
  assert.deepEqual(await ids_("?pipeline=project&stage=Won"), [ids.projB]);
  assert.ok(!(await ids_("?pipeline=project&open=1")).includes(ids.projB), "won is not open");
  const facets = (await api.call("GET", "/crm/facets?pipeline=project")).body;
  assert.deepEqual(facets.projects.map((p: { name: string }) => p.name), ["Synthetic Project X", "Synthetic Project Y"]);
  assert.deepEqual(facets.interventions, ["Sewage Reuse"]);
  const map = (await api.call("GET", "/crm/map?pipeline=project")).body;
  assert.ok(map.every((m: { located_by: string; project_id: number }) => m.located_by === "project" && m.project_id === ids.px), "project opportunities located at their project");
});

/* ---------------- dashboard & daily brief ---------------- */

test("dashboard and daily brief distinguish the pipelines; existing counts stay correct", async () => {
  const s = (await api.call("GET", "/dashboard/summary")).body;
  const all = (await api.call("GET", "/crm")).body as Opp[];
  assert.equal(s.crmOpportunities, all.length);
  assert.equal(s.activeOpportunities, all.filter((o) => o.stage_kind === "open").length, "won project opportunities are not active");
  assert.deepEqual([s.pipelines.relationship.total, s.pipelines.project.total], [all.filter((o) => o.pipeline === "relationship").length, all.filter((o) => o.pipeline === "project").length]);
  assert.equal(s.pipelines.project.won, 1);
  assert.equal(s.pipelines.relationship.won, 0);
  assert.ok(s.pipeline.some((p: { pipeline: string; status: string }) => p.pipeline === "project" && p.status === "Won"));
  assert.ok(s.pipeline.some((p: { pipeline: string; status: string }) => p.pipeline === "relationship" && p.status === "Call"));
  const brief = (await api.call("GET", "/ai/daily-brief")).body;
  assert.equal(brief.pipelines.project.followUpsDue, 1, "the project-opportunity task due today");
  assert.equal(brief.counts.unassignedOpportunities, all.filter((o) => o.stage_kind === "open" && !(o as unknown as { owner_id: number | null }).owner_id).length);
});

test("Next Action Agent: project actions name the project and its consultant; relationship actions keep their wording", async () => {
  // Quiet project opportunity in technical discussion, with an MEP consultant on the project.
  await db().query(`UPDATE activities SET occurred_at = now() - interval '9 days' WHERE opportunity_id = $1`, [ids.projA]);
  await db().query(`UPDATE tasks SET status = 'Done' WHERE opportunity_id = $1`, [ids.projA]);
  await db().query(`UPDATE crm_opportunities SET next_follow_up = NULL, call_status = 'Not Started' WHERE id = $1`, [ids.projA]);
  const recs = (await api.call("GET", "/ai/recommendations")).body as { title: string; reason: string; opportunity_id: number; organization_id: number; payload: { project_id?: number }; action_type: string }[];
  const proj = recs.find((r) => r.opportunity_id === ids.projA && r.action_type === "contact_consultant");
  assert.ok(proj, recs.map((r) => r.title).join(" | "));
  assert.equal(proj.title, "Contact the MEP Consultant (Synthetic MEP Consultants) about the water discussion for Synthetic Project X");
  assert.equal(proj.payload.project_id, ids.px);
  assert.match(proj.reason, /Project opportunity: Synthetic Project X \(customer Synthetic Mistry Architects\)/);
  // The developer's project opportunity (Identified, never contacted) reads as a project action, not an organization one.
  const dev = recs.find((r) => r.opportunity_id === ids.devProj);
  assert.equal(dev?.title, "Contact Synthetic Prestige Group about Synthetic Project X");
  // Relationship wording unchanged for the Customer opportunity; a second relationship is named so the two are distinguishable.
  const relUnassigned = recs.find((r) => r.opportunity_id === ids.relB && r.action_type === "assign_owner");
  assert.equal(relUnassigned?.title, "Assign Synthetic Mistry Architects (Specification partnership)");
  assert.ok(!recs.some((r) => r.opportunity_id === ids.relA && /\(/.test(r.title)), "Customer relationship keeps the MVP wording");
  // Won opportunities get nothing.
  assert.ok(!recs.some((r) => r.opportunity_id === ids.projB), "won project opportunity needs no action");
  const s = (await api.call("GET", "/dashboard/summary")).body;
  assert.ok(s.pipelines.project.needingAction >= 2 && s.pipelines.relationship.needingAction >= 1);
});
