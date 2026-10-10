import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { todayIST } from "../lib/time";
import { startTestApi, type TestApi } from "./helpers";

let api: TestApi;
let orgId: number;
let hospitalId: number;
let oppId: number;
before(async () => {
  api = await startTestApi();
  orgId = (await api.call("POST", "/organizations", { data: { name: "Greenfield Textiles", org_type: "Manufacturing", sector: "Textile dyeing", address: "Peenya, Bengaluru 560058", phone: "9845011111" } })).body.id;
  hospitalId = (await api.call("POST", "/organizations", { data: { name: "Lakeview Hospital", org_type: "Hospital", address: "Whitefield" } })).body.id;
});
after(() => api.close());

test("add to CRM: creates a New opportunity with owner, once per organization", async () => {
  const r = await api.call("POST", "/crm", { organization_id: orgId, owner_id: 2, notes: "ZLD candidate" });
  assert.equal(r.status, 201);
  oppId = r.body.id;
  assert.equal(r.body.status, "New");
  assert.equal(r.body.owner_name, "Akash");
  assert.equal(r.body.call_status, "Not Started");
  const again = await api.call("POST", "/crm", { organization_id: orgId });
  assert.equal(again.status, 409);
  assert.equal(again.body.opportunity_id, oppId);
  assert.equal((await api.call("POST", "/crm", { organization_id: 999999 })).status, 404);
  const org = (await api.call("GET", "/organizations?crm=in")).body;
  assert.deepEqual(org.map((o: { name: string; crm_status: string }) => [o.name, o.crm_status]), [["Greenfield Textiles", "New"]]);
});

test("interactions advance the pipeline forward and are recorded in the timeline", async () => {
  let r = await api.call("POST", `/crm/${oppId}/interactions`, { type: "contact_attempted", note: "Called reception" });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.status, r.body.call_status], ["Contacted", "Contact Attempted"]);
  assert.ok(r.body.last_contact_at);

  r = await api.call("POST", `/crm/${oppId}/interactions`, {
    type: "call_completed",
    note: "Spoke to plant head",
    follow_up: { due_date: "2026-01-05", title: "Send ZLD brochure", priority: "High" },
  });
  assert.deepEqual([r.body.status, r.body.call_status, r.body.next_follow_up], ["Call", "Call Completed", "2026-01-05"]);

  r = await api.call("POST", `/crm/${oppId}/interactions`, { type: "proposal_sent" });
  assert.deepEqual([r.body.status, r.body.proposal_status], ["Proposal Sent", "Sent"]);
  assert.ok(r.body.proposal_sent_at);

  r = await api.call("POST", `/crm/${oppId}/interactions`, { type: "note", note: "Waiting on budget" });
  assert.equal(r.body.status, "Proposal Sent", "notes never move the stage");
  assert.equal((await api.call("POST", `/crm/${oppId}/interactions`, { type: "carrier_pigeon" })).status, 400);

  const d = (await api.call("GET", `/organizations/${orgId}`)).body;
  const summaries = d.activities.map((a: { summary: string }) => a.summary);
  for (const expected of [/Added to CRM by Fayaas/, /Assigned to Akash/, /Contact attempted: Called reception/, /Status changed: New → Contacted/, /Call completed/, /Follow-up scheduled for 2026-01-05/, /Proposal sent/, /Note: Waiting on budget/]) {
    assert.ok(summaries.some((s: string) => expected.test(s)), `timeline missing ${expected}`);
  }
});

test("PATCH: owner/status/proposal/pilot changes are validated and logged; activities are append-only", async () => {
  const before = (await api.call("GET", `/organizations/${orgId}`)).body.activities.length;
  let r = await api.call("PATCH", `/crm/${oppId}`, { pilot_status: "In Progress" });
  assert.equal(r.body.status, "Pilot", "pilot in progress advances to Pilot");
  r = await api.call("PATCH", `/crm/${oppId}`, { owner_id: 1 });
  assert.equal(r.body.owner_name, "Fayaas");
  r = await api.call("PATCH", `/crm/${oppId}`, { status: "Nurture" });
  assert.equal(r.body.status, "Nurture");
  assert.equal((await api.call("PATCH", `/crm/${oppId}`, { status: "Teleported" })).status, 400);
  assert.equal((await api.call("PATCH", `/crm/${oppId}`, { call_status: "Maybe" })).status, 400);
  assert.equal((await api.call("PATCH", `/crm/${oppId}`, { proposal_status: "Lost in mail" })).status, 400);
  const after = (await api.call("GET", `/organizations/${orgId}`)).body.activities.length;
  // pilot status + its automatic move to the Pilot stage (Phase 7: every stage change is on the timeline) + owner + Nurture
  assert.equal(after, before + 4, "every change adds a timeline entry, nothing is removed");
  const byOwner = (await api.call("GET", "/crm?owner=1")).body;
  assert.deepEqual(byOwner.map((o: { id: number }) => o.id), [oppId]);
  assert.equal((await api.call("GET", "/crm?owner=2")).body.length, 0);
});

test("tasks: overdue detection, next follow-up sync, completion logged", async () => {
  const tasks = (await api.call("GET", "/tasks?scope=overdue")).body;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Send ZLD brochure");
  assert.equal(tasks[0].overdue, true);
  assert.equal((await api.call("GET", "/dashboard/summary")).body.overdueFollowUps, 1);

  const t2 = await api.call("POST", "/tasks", { organization_id: orgId, title: "Call ops manager", task_type: "Call", due_date: todayIST(), priority: "High", assigned_to: 2 });
  assert.equal(t2.status, 201);
  assert.equal(t2.body.opportunity_id, oppId, "task attaches to the organization's opportunity");
  assert.equal((await api.call("GET", "/tasks?scope=today")).body.length, 1);
  assert.equal((await api.call("POST", "/tasks", { title: "" })).status, 400);
  assert.equal((await api.call("POST", "/tasks", { title: "x", due_date: "05/01/2026" })).status, 400);

  const done = await api.call("PATCH", `/tasks/${tasks[0].id}`, { status: "Done" });
  assert.equal(done.body.status, "Done");
  const opp = (await api.call("GET", "/crm")).body.find((o: { id: number }) => o.id === oppId);
  assert.equal(opp.next_follow_up, todayIST(), "next follow-up = earliest remaining pending task");
  const d = (await api.call("GET", `/organizations/${orgId}`)).body;
  assert.ok(d.activities.some((a: { summary: string }) => /Follow-up completed: Send ZLD brochure/.test(a.summary)));
  assert.equal((await api.call("GET", "/tasks?scope=overdue")).body.length, 0);
});

test("dashboard pipeline counts", async () => {
  await api.call("POST", "/crm", { organization_id: hospitalId }); // unassigned
  const s = (await api.call("GET", "/dashboard/summary")).body;
  assert.equal(s.crmOpportunities, 2);
  assert.equal(s.activeOpportunities, 2);
  assert.equal(s.proposalsSent, 1);
  assert.equal(s.pilots, 1);
  const counts = Object.fromEntries(s.pipeline.map((p: { status: string; count: number }) => [p.status, p.count]));
  assert.deepEqual(counts, { Nurture: 1, New: 1 });
});

test("daily brief and recommendations: reasons, assignment, resolve", async () => {
  const brief = (await api.call("GET", "/ai/daily-brief")).body;
  assert.equal(brief.date, todayIST());
  assert.equal(brief.counts.unassignedOpportunities, 1);
  assert.equal(brief.counts.callsToday, 1);
  assert.equal(brief.counts.proposalsAwaitingResponse, 1);
  const assign = brief.recommendations.find((r: { title: string }) => r.title === "Assign Lakeview Hospital");
  assert.ok(assign, "unassigned opportunity must produce an Assign recommendation");
  assert.match(assign.reason, /no owner/);
  assert.ok(brief.recommendations.every((r: { reason: string }) => r.reason.length > 0), "every recommendation explains why");

  assert.equal((await api.call("POST", `/ai/recommendations/${assign.id}/maybe`)).status, 400);
  assert.equal((await api.call("POST", `/ai/recommendations/${assign.id}/dismissed`)).status, 200);
  const list = (await api.call("GET", "/ai/recommendations")).body;
  assert.ok(!list.some((r: { id: number }) => r.id === assign.id));

  const mine = (await api.call("GET", "/ai/daily-brief?user=2")).body;
  assert.ok(mine.recommendations.every((r: { assigned_to: number | null }) => r.assigned_to === 2 || r.assigned_to === null));

  const all = await api.call("POST", "/ai/assess-all");
  assert.equal(all.body.assessed, 2);
});
