import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import express from "express";
import { initDb, type Database } from "../db";
import { migrate } from "../db/migrate";
import { HttpError } from "../lib/http";
import { insertOrganization } from "../lib/organizations";
import { normalizeRecord } from "../lib/normalize";
import { setEmailProvider, webhookTokenMatches, type EmailProvider, type OutboundEmail, type SendResult } from "./provider";
import { createBrevoProvider } from "./brevo";
import { emailConfig } from "./config";
import * as svc from "./service";
import { runEmailWorker, sendTestEmail, claimDue, backoffMs, testRecipientStatus } from "./scheduler";
import { processInbound, processProviderEvents, unsubscribeByToken } from "./webhooks";
import { renderEmail, sanitizeHtml } from "./template";
import { checkDraft, generateDraft, setDraftGenerator } from "./draft";

const here = path.dirname(fileURLToPath(import.meta.url));
let db: Database;
let ADMIN: number;
let MEMBER: number;
const T0 = new Date("2026-10-12T05:00:00Z"); // Monday 10:30 IST
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60000);

/* ---------- mock provider */
type Handler = (m: OutboundEmail) => Promise<SendResult> | SendResult;
const sent: OutboundEmail[] = [];
let handler: Handler = () => ({ status: "accepted", providerMessageId: `<msg-${sent.length}@test>` });
const brevoParser = createBrevoProvider({ ...emailConfig(), brevoApiKey: "x" });
const mock: EmailProvider = {
  name: "mock",
  async send(m) {
    sent.push(m);
    return handler(m);
  },
  verifyWebhook: (req) => webhookTokenMatches(req, "secret-token"),
  parseEvents: (b) => brevoParser.parseEvents(b),
  parseInbound: (b) => brevoParser.parseInbound(b),
};

before(async () => {
  process.env.PGLITE_DATA_DIR = "memory://";
  process.env.GEOCODER = "none";
  delete process.env.DATABASE_URL;
  delete process.env.EMAIL_DRY_RUN;
  delete process.env.EMAIL_TEST_RECIPIENTS;
  delete process.env.EMAIL_RECIPIENT_ALLOWLIST;
  process.env.EMAIL_SENDER_NAME = "Test Sender";
  process.env.EMAIL_REPLY_DOMAIN = "reply.example.com";
  process.env.EMAIL_RETRY_BASE_SECONDS = "60";
  db = await initDb();
  ADMIN = (await db.query<{ id: number }>(`INSERT INTO users (name, role, email) VALUES ('Akash', 'outreach', 'akash@team.example') RETURNING id`)).rows[0].id;
  MEMBER = (await db.query<{ id: number }>(`INSERT INTO users (name, role) VALUES ('Fayaas', 'data collection') RETURNING id`)).rows[0].id;
  setEmailProvider(mock);
});
after(async () => {
  setEmailProvider(null);
  setDraftGenerator(null);
});
beforeEach(async () => {
  // Each test starts with no sendable campaigns left over from earlier tests.
  await db.query(`UPDATE email_sequence_enrollments SET status = 'cancelled' WHERE status IN ('pending', 'active', 'paused')`);
  await db.query(`UPDATE email_campaigns SET status = 'cancelled' WHERE status IN ('active', 'scheduled', 'paused')`);
  sent.length = 0;
  handler = () => ({ status: "accepted", providerMessageId: `<msg-${sent.length}-${Math.random()}@test>` });
});

let orgSeq = 0;
async function prospect(opts: { email?: string | null; crmStatus?: string; name?: string } = {}) {
  orgSeq++;
  const n = normalizeRecord({ name: `Test Org ${orgSeq}`, org_type: "Hospital" }, "test");
  const orgId = await insertOrganization(db, n.data, { fieldSources: n.field_sources, sourceId: null, actorId: ADMIN, activitySummary: "test" });
  const contactId = (
    await db.query<{ id: number }>(`INSERT INTO contacts (organization_id, name, designation, email) VALUES ($1, $2, 'Facility Manager', $3) RETURNING id`, [
      orgId,
      opts.name ?? `Priya ${orgSeq}`,
      opts.email === undefined ? `person${orgSeq}@org${orgSeq}.example` : opts.email,
    ])
  ).rows[0].id;
  const oppId = (await db.query<{ id: number }>(`INSERT INTO crm_opportunities (organization_id, owner_id, status, contact_id) VALUES ($1, $2, $3, $4) RETURNING id`, [orgId, ADMIN, opts.crmStatus ?? "New", contactId])).rows[0].id;
  return { orgId, contactId, oppId };
}

/** Campaign with Day 1 / Day 4 / Day 8 steps and no send window. */
async function campaign(name = "Test campaign", stepCount = 3) {
  const c = await db.tx((q) => svc.createCampaign(q, { name, description: "STP and water audit services", settings: { send_window: null } }, ADMIN));
  const delays = [0, 3 * 1440, 4 * 1440];
  for (let i = 0; i < stepCount; i++) {
    await db.tx((q) => svc.addStep(q, c.id, { subject_template: `Step ${i + 1} for {{organization.name}}`, text_template: `Hi {{contact.first_name|there}},\n\nMessage ${i + 1}.`, delay_minutes: delays[i] ?? 1440 }, ADMIN));
  }
  return c;
}

async function activeCampaignWith(n: number, name?: string) {
  const c = await campaign(name);
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(await prospect());
  await db.tx((q) => svc.enrollContacts(q, c.id, ps.map((p) => p.contactId), ADMIN, T0));
  await db.tx((q) => svc.approveCampaign(q, c.id, ADMIN));
  await db.tx((q) => svc.activateCampaign(q, c.id, ADMIN, { confirm_recipients: n }, T0));
  return { c, ps };
}

const enrollmentsOf = async (campaignId: number) =>
  (await db.query<{ id: number; status: string; current_step: number; next_send_at: string | null; stop_reason: string | null; last_error: string | null; reply_token: string; unsubscribe_token: string; attempt_count: number }>(
    `SELECT * FROM email_sequence_enrollments WHERE campaign_id = $1 ORDER BY id`,
    [campaignId],
  )).rows;

const rejects = async (p: Promise<unknown>, status: number, re?: RegExp) => {
  await assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof HttpError, `expected HttpError, got ${e}`);
    assert.equal(e.status, status, e.message);
    if (re) assert.match(e.message, re);
    return true;
  });
};

/* ================================================================== tests */

test("schema: email migration is applied once and re-running migrations is a no-op (PGlite)", async () => {
  const again = await migrate(db, { log: () => undefined });
  assert.deepEqual(again.applied, []);
  assert.ok(again.alreadyApplied.includes("0011"));
  // 0011 is IF NOT EXISTS throughout, so it also adopts tables created by the pre-migration email branch.
  const sql = fs.readFileSync(path.join(here, "../db/migrations/0011_email_outreach.sql"), "utf8");
  await db.exec(sql);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name LIKE 'email_%'`);
  assert.equal(rows[0].n, 7);
});

test("campaign creation validates input", async () => {
  await rejects(db.tx((q) => svc.createCampaign(q, { name: "  " }, ADMIN)), 400, /name is required/);
  await rejects(db.tx((q) => svc.createCampaign(q, { name: "X", settings: { send_window: { start_hour: 18, end_hour: 9 } } }, ADMIN)), 400, /Send window/);
  const c = await db.tx((q) => svc.createCampaign(q, { name: "Hospitals Q4" }, ADMIN));
  assert.equal(c.status, "draft");
  assert.deepEqual(c.settings.send_window, { start_hour: 9, end_hour: 18, weekdays_only: true });
  await rejects(db.tx((q) => svc.addStep(q, c.id, { subject_template: "Hi {{contact.shoe_size}}", text_template: "x" }, ADMIN)), 400, /Unknown personalization/);
  await rejects(db.tx((q) => svc.addStep(q, c.id, { subject_template: "Hi", text_template: "x", delay_minutes: -5 }, ADMIN)), 400);
});

test("sequence steps: ordering, reorder, delete renumbers, edits invalidate approval", async () => {
  const c = await campaign("Ordering", 3);
  let steps = await svc.listSteps(db, c.id);
  assert.deepEqual(steps.map((s) => s.step_order), [1, 2, 3]);
  assert.deepEqual(steps.map((s) => s.delay_minutes), [0, 4320, 5760]); // Day 1, Day 4, Day 8
  steps = await db.tx((q) => svc.reorderSteps(q, c.id, [steps[2].id, steps[0].id, steps[1].id], ADMIN));
  assert.deepEqual(steps.map((s) => s.subject_template.slice(0, 6)), ["Step 3", "Step 1", "Step 2"]);
  await rejects(db.tx((q) => svc.reorderSteps(q, c.id, [steps[0].id], ADMIN)), 400);
  await db.tx((q) => svc.deleteStep(q, c.id, steps[1].id, ADMIN));
  assert.deepEqual((await svc.listSteps(db, c.id)).map((s) => s.step_order), [1, 2]);

  const p = await prospect();
  await db.tx((q) => svc.enrollContacts(q, c.id, [p.contactId], ADMIN));
  await db.tx((q) => svc.approveCampaign(q, c.id, ADMIN));
  assert.equal((await svc.getCampaign(db, c.id)).approved_version, (await svc.getCampaign(db, c.id)).content_version);
  await db.tx((q) => svc.updateStep(q, c.id, steps[0].id, { subject_template: "Changed" }, ADMIN));
  const after = await svc.getCampaign(db, c.id);
  assert.equal(after.approved_at, null);
  await rejects(db.tx((q) => svc.activateCampaign(q, c.id, ADMIN, { confirm_recipients: 1 })), 409, /approved/);
});

test("send window alignment uses India Standard Time", () => {
  const w = { start_hour: 9, end_hour: 18, weekdays_only: true };
  // Saturday 2026-10-10 12:00 IST → Monday 09:00 IST (03:30Z)
  assert.equal(svc.alignToWindow(new Date("2026-10-10T06:30:00Z"), w).toISOString(), "2026-10-12T03:30:00.000Z");
  // Monday 20:00 IST → Tuesday 09:00 IST
  assert.equal(svc.alignToWindow(new Date("2026-10-12T14:30:00Z"), w).toISOString(), "2026-10-13T03:30:00.000Z");
  // Inside the window → unchanged
  assert.equal(svc.alignToWindow(T0, w).toISOString(), T0.toISOString());
  assert.equal(svc.alignToWindow(T0, null).toISOString(), T0.toISOString());
});

test("enrollment: eligibility checks and duplicate prevention", async () => {
  const c = await campaign("Enroll");
  const ok = await prospect();
  const noEmail = await prospect({ email: null });
  const lost = await prospect({ crmStatus: "Lost" });
  const r = await db.tx((q) => svc.enrollContacts(q, c.id, [ok.contactId, noEmail.contactId, lost.contactId, ok.contactId], ADMIN));
  assert.equal(r.enrolled, 1);
  const reasons = Object.fromEntries(r.skipped.map((s) => [s.contact_id, s.reasons.join("; ")]));
  assert.match(reasons[noEmail.contactId], /No email/);
  assert.match(reasons[lost.contactId], /CRM status is Lost/);

  const again = await db.tx((q) => svc.enrollContacts(q, c.id, [ok.contactId], ADMIN));
  assert.equal(again.enrolled, 0);
  assert.match(again.skipped[0].reasons.join(), /Already enrolled/);
  // Database-level guard too
  await assert.rejects(
    db.query(`INSERT INTO email_sequence_enrollments (campaign_id, contact_id, email, status, unsubscribe_token, reply_token) VALUES ($1, $2, 'dup@x.example', 'active', 'tok-dup-1', 'rt-dup-1')`, [c.id, ok.contactId]),
    /duplicate key/,
  );
  const page = await svc.eligibleContacts(db, c.id, { limit: 500, offset: 0 });
  assert.equal(page.items.find((x) => x.contact_id === ok.contactId)?.eligible, false);
});

test("suppression: suppressed contacts are not eligible and are re-checked right before sending", async () => {
  const c = await campaign("Suppression");
  const a = await prospect();
  const b = await prospect();
  await db.tx((q) => svc.suppressEmail(q, `person${orgSeq - 1}@org${orgSeq - 1}.example`, "manual", "test"));
  const r = await db.tx((q) => svc.enrollContacts(q, c.id, [a.contactId, b.contactId], ADMIN));
  assert.equal(r.enrolled, 1);
  assert.match(r.skipped[0].reasons.join(), /Suppressed/);
  await db.tx((q) => svc.approveCampaign(q, c.id, ADMIN));
  await db.tx((q) => svc.activateCampaign(q, c.id, ADMIN, { confirm_recipients: 1 }, T0));
  // Suppressed after activation, bypassing suppressEmail's own enrollment stop, to prove the worker re-checks.
  const [e] = await enrollmentsOf(c.id);
  const email = (await db.query<{ email: string }>(`SELECT email FROM email_sequence_enrollments WHERE id = $1`, [e.id])).rows[0].email;
  await db.query(`INSERT INTO email_suppressions (email, reason, source) VALUES ($1, 'unsubscribed', 'test')`, [email]);
  await runEmailWorker(db, { now: at(1), provider: mock });
  assert.equal(sent.length, 0);
  assert.equal((await enrollmentsOf(c.id))[0].status, "unsubscribed");
});

test("unsubscribe link suppresses the address across all campaigns", async () => {
  const p = await prospect();
  const c1 = await campaign("Unsub A");
  const c2 = await campaign("Unsub B");
  await db.tx((q) => svc.enrollContacts(q, c1.id, [p.contactId], ADMIN));
  await db.tx((q) => svc.enrollContacts(q, c2.id, [p.contactId], ADMIN));
  const [e1] = await enrollmentsOf(c1.id);
  assert.equal(await unsubscribeByToken(db, "not-a-real-token-1234567890", null), null);
  const r = await unsubscribeByToken(db, e1.unsubscribe_token, null);
  assert.ok(r?.newly);
  assert.equal((await enrollmentsOf(c1.id))[0].status, "unsubscribed");
  assert.equal((await enrollmentsOf(c2.id))[0].status, "unsubscribed");
  assert.ok(await svc.suppressionFor(db, r!.email));
  // Second click is harmless
  assert.equal((await unsubscribeByToken(db, e1.unsubscribe_token, null))?.newly, false);
});

test("rendered emails carry the footer, unsubscribe link, and escape variables in HTML", () => {
  const r = renderEmail(
    { subject: "Hello {{organization.name}}", text: "Hi {{contact.first_name|there}}, about {{organization.area}}" },
    { "organization.name": "<b>Acme</b>", "contact.first_name": null },
    { senderName: "S", company: "WSIS Co", address: "1 Road, Bengaluru", unsubscribeUrl: "https://x.example/api/email/unsubscribe/abc" },
  );
  assert.equal(r.subject, "Hello <b>Acme</b>"); // subject is plain text
  assert.match(r.text, /Hi there, about/);
  assert.deepEqual(r.missing, ["organization.area"]);
  assert.match(r.text, /unsubscribe\/abc/);
  assert.match(r.html, /1 Road, Bengaluru/);
  assert.doesNotMatch(sanitizeHtml(`<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>`), /script|onclick|javascript:/);
});

test("test email goes through the (mocked) provider and only to allowed recipients", async () => {
  const c = await campaign("Test send", 1);
  const [step] = await svc.listSteps(db, c.id);
  await rejects(sendTestEmail(db, { campaignId: c.id, stepId: step.id, to: "stranger@elsewhere.example", actor: { id: ADMIN, name: "Akash" }, provider: mock }), 403);
  const r = await sendTestEmail(db, { campaignId: c.id, stepId: step.id, to: "akash@team.example", actor: { id: ADMIN, name: "Akash" }, provider: mock });
  assert.equal(r.result.status, "accepted");
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^\[TEST\]/);
  assert.equal(sent[0].to.email, "akash@team.example");
});

test("worker: only due enrollments of active campaigns in the current mode are selected", async () => {
  const { c } = await activeCampaignWith(2, "Due selection");
  const other = await campaign("Draft only");
  const p = await prospect();
  await db.tx((q) => svc.enrollContacts(q, other.id, [p.contactId], ADMIN));

  const r1 = await runEmailWorker(db, { now: at(-10), provider: mock }); // before activation time → nothing due
  assert.equal(r1.attempted, 0);
  const r2 = await runEmailWorker(db, { now: at(1), provider: mock });
  assert.equal(r2.accepted, 2);
  const es = await enrollmentsOf(c.id);
  assert.ok(es.every((e) => e.current_step === 1 && e.status === "active"));
  // Step 2 is 3 days after step 1 was sent
  assert.equal(new Date(es[0].next_send_at!).toISOString(), at(1 + 3 * 1440).toISOString());
  assert.equal((await runEmailWorker(db, { now: at(2 * 1440), provider: mock })).attempted, 0);
  assert.equal((await runEmailWorker(db, { now: at(3 * 1440 + 2), provider: mock })).accepted, 2);
  assert.equal((await enrollmentsOf(other.id))[0].status, "pending"); // draft campaign never sends
  // Reply-To carries the per-enrollment token; List-Unsubscribe header present
  assert.match(sent[0].replyTo!.email, /^reply-[0-9a-f]{40}@reply\.example\.com$/);
  assert.match(sent[0].headers!["List-Unsubscribe"], /unsubscribe/);

  // A dry-run campaign is never picked up by a live worker
  process.env.EMAIL_DRY_RUN = "false";
  try {
    assert.equal((await runEmailWorker(db, { now: at(8 * 1440), provider: mock })).claimed, 0);
  } finally {
    delete process.env.EMAIL_DRY_RUN;
  }
  // CRM timeline records the sends
  const { rows } = await db.query(`SELECT 1 FROM activities WHERE type = 'email_sent' AND details->>'campaign_id' = $1`, [String(c.id)]);
  assert.equal(rows.length, 4);
});

test("worker: completes sequence and campaign after the last step", async () => {
  const { c } = await activeCampaignWith(1, "Completion");
  await runEmailWorker(db, { now: at(1), provider: mock });
  await runEmailWorker(db, { now: at(3 * 1440 + 2), provider: mock });
  await runEmailWorker(db, { now: at(7 * 1440 + 3), provider: mock });
  assert.equal(sent.length, 3);
  assert.equal((await enrollmentsOf(c.id))[0].status, "completed");
  assert.equal((await svc.getCampaign(db, c.id)).status, "completed");
  const a = await svc.campaignAnalytics(db, c.id);
  assert.equal(a.accepted, 3);
  assert.equal(a.recipients_contacted, 1);
});

test("concurrency: parallel workers never send the same step twice", async () => {
  const { c } = await activeCampaignWith(3, "Concurrency");
  handler = async () => {
    await new Promise((r) => setTimeout(r, 20));
    return { status: "accepted", providerMessageId: `<c-${Math.random()}@t>` };
  };
  const results = await Promise.all([1, 2, 3, 4].map(() => runEmailWorker(db, { now: at(1), provider: mock })));
  assert.equal(results.reduce((n, r) => n + r.accepted, 0), 3);
  assert.equal(sent.length, 3);
  assert.equal(new Set(sent.map((m) => m.to.email)).size, 3);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM email_messages WHERE campaign_id = $1`, [c.id]);
  assert.equal(rows[0].n, 3);
});

test("concurrency: a claim cannot be taken while its lease is valid; an interrupted attempt is never resent", async () => {
  const { c } = await activeCampaignWith(1, "Lease");
  const ids1 = await claimDue(db, { now: at(1), limit: 10, mode: "dry_run", leaseMs: 600000, token: "worker-a" });
  const ids2 = await claimDue(db, { now: at(2), limit: 10, mode: "dry_run", leaseMs: 600000, token: "worker-b" });
  assert.equal(ids1.length, 1);
  assert.equal(ids2.length, 0);
  // Simulate worker A crashing after reserving the message but before the provider call returned.
  const [e] = await enrollmentsOf(c.id);
  const [step] = await svc.listSteps(db, c.id);
  await db.query(`INSERT INTO email_messages (campaign_id, enrollment_id, step_id, status, send_mode, provider, subject) VALUES ($1, $2, $3, 'sending', 'dry_run', 'mock', 's')`, [c.id, e.id, step.id]);
  // After the lease expires another worker claims it, sees the in-flight message, and holds instead of resending.
  await runEmailWorker(db, { now: at(20), provider: mock });
  assert.equal(sent.length, 0);
  const [held] = await enrollmentsOf(c.id);
  assert.equal(held.status, "paused");
  assert.equal(held.stop_reason, "ambiguous_send");
  await rejects(db.tx((q) => svc.resumeEnrollment(q, e.id, ADMIN, {})), 409, /may or may not/);
  await db.tx((q) => svc.resumeEnrollment(q, e.id, ADMIN, { ambiguous_resolution: "mark_sent" }, at(21)));
  const [resumed] = await enrollmentsOf(c.id);
  assert.equal(resumed.status, "active");
  assert.equal(resumed.current_step, 1);
});

test("retry: transient errors back off and retry; permanent errors stop; ambiguous outcomes are held", async () => {
  const { c, ps } = await activeCampaignWith(1, "Retry");
  handler = () => ({ status: "transient", error: "Brevo 429", httpStatus: 429 });
  await runEmailWorker(db, { now: at(1), provider: mock });
  let [e] = await enrollmentsOf(c.id);
  assert.equal(e.status, "active");
  assert.equal(e.attempt_count, 1);
  assert.equal(new Date(e.next_send_at!).toISOString(), at(1 + 1).toISOString()); // base 60 s
  assert.equal(backoffMs(3, 60000), 240000);
  handler = () => ({ status: "accepted", providerMessageId: "<ok@t>" });
  await runEmailWorker(db, { now: at(3), provider: mock });
  [e] = await enrollmentsOf(c.id);
  assert.equal(e.current_step, 1);
  const m = (await db.query<{ attempts: number; status: string }>(`SELECT attempts, status FROM email_messages WHERE enrollment_id = $1`, [e.id])).rows[0];
  assert.deepEqual(m, { attempts: 2, status: "sent" });

  // Gives up after EMAIL_MAX_SEND_ATTEMPTS (default 4)
  const g = await activeCampaignWith(1, "Give up");
  handler = () => ({ status: "transient", error: "Brevo 503", httpStatus: 503 });
  for (let i = 1; i <= 6; i++) await runEmailWorker(db, { now: at(i * 30), provider: mock });
  assert.equal(sent.filter((s) => s.to.email === `person${orgSeq}@org${orgSeq}.example`).length, 4);
  assert.equal((await enrollmentsOf(g.c.id))[0].status, "failed");

  // Permanent: no retry
  const p = await activeCampaignWith(1, "Permanent");
  handler = () => ({ status: "permanent", error: "Brevo 400 invalid_parameter", httpStatus: 400 });
  await runEmailWorker(db, { now: at(1), provider: mock });
  await runEmailWorker(db, { now: at(500), provider: mock });
  assert.equal((await enrollmentsOf(p.c.id))[0].status, "failed");

  // Ambiguous (timeout): held, never retried automatically
  const a = await activeCampaignWith(1, "Ambiguous");
  sent.length = 0;
  handler = () => ({ status: "ambiguous", error: "Timed out" });
  await runEmailWorker(db, { now: at(1), provider: mock });
  await runEmailWorker(db, { now: at(600), provider: mock });
  assert.equal(sent.length, 1);
  const [amb] = await enrollmentsOf(a.c.id);
  assert.equal(amb.status, "paused");
  // A later provider event for that message reconciles it as sent and releases the hold.
  const msg = (await db.query<{ id: number }>(`SELECT id FROM email_messages WHERE enrollment_id = $1`, [amb.id])).rows[0];
  await processProviderEvents(db, mock.parseEvents({ event: "delivered", email: "x@y.example", "message-id": "<late@t>", "X-Mailin-custom": `wsis-msg-${msg.id}`, ts_epoch: 1760000000000 }), mock);
  const [rec] = await enrollmentsOf(a.c.id);
  assert.equal(rec.status, "active");
  assert.equal(rec.current_step, 1);
  void ps;
});

test("webhooks: authenticity check and idempotent processing; hard bounce suppresses and stops", async () => {
  const fakeReq = (headers: Record<string, string>) => ({ header: (n: string) => headers[n.toLowerCase()] }) as any;
  assert.equal(mock.verifyWebhook(fakeReq({})), false);
  assert.equal(mock.verifyWebhook(fakeReq({ authorization: "Bearer wrong" })), false);
  assert.equal(mock.verifyWebhook(fakeReq({ authorization: "Bearer secret-token" })), true);
  assert.equal(mock.verifyWebhook(fakeReq({ "x-webhook-token": "secret-token" })), true);
  assert.equal(mock.verifyWebhook(fakeReq({ authorization: `Basic ${Buffer.from("brevo:secret-token").toString("base64")}` })), true);
  assert.equal(webhookTokenMatches(fakeReq({ authorization: "Bearer " }), null), false); // unset token never matches

  const { c } = await activeCampaignWith(1, "Bounce");
  await runEmailWorker(db, { now: at(1), provider: mock });
  const [e] = await enrollmentsOf(c.id);
  const msg = (await db.query<{ provider_message_id: string }>(`SELECT provider_message_id FROM email_messages WHERE enrollment_id = $1`, [e.id])).rows[0];
  const email = sent[0].to.email;
  const payload = { event: "hard_bounce", email, "message-id": msg.provider_message_id, reason: "550 no such user", ts_epoch: 1760000001000 };
  const first = await processProviderEvents(db, mock.parseEvents(payload), mock);
  const second = await processProviderEvents(db, mock.parseEvents(payload), mock);
  assert.deepEqual(first, { processed: 1, duplicates: 0 });
  assert.deepEqual(second, { processed: 0, duplicates: 1 });
  assert.equal((await enrollmentsOf(c.id))[0].status, "bounced");
  assert.equal((await svc.suppressionFor(db, email))?.reason, "hard_bounce");
  // Bounced recipient does not get step 2
  await runEmailWorker(db, { now: at(5 * 1440), provider: mock });
  assert.equal(sent.length, 1);
  const a = await svc.campaignAnalytics(db, c.id);
  assert.equal(a.hard_bounced, 1);
});

test("replies: a reply to the tokenised Reply-To address stops the sequence and creates a follow-up task", async () => {
  const { c } = await activeCampaignWith(2, "Replies");
  await runEmailWorker(db, { now: at(1), provider: mock });
  const [e1, e2] = await enrollmentsOf(c.id);
  const inbound = {
    items: [
      { Uuid: ["u-1"], MessageId: "<r1@client>", InReplyTo: null, From: { Address: sent[0].to.email, Name: "Priya" }, Recipients: [`reply-${e1.reply_token}@reply.example.com`], To: [], Subject: "Re: Step 1", ExtractedMarkdownMessage: "Interested, call me.", Headers: {} },
      { Uuid: ["u-2"], MessageId: "<r2@client>", From: { Address: sent[1].to.email }, Recipients: [`reply-${e2.reply_token}@reply.example.com`], Subject: "Automatic reply: out of office", ExtractedMarkdownMessage: "Away", Headers: { "Auto-Submitted": "auto-replied" } },
    ],
  };
  const r = await processInbound(db, mock.parseInbound(inbound), mock);
  assert.equal(r[0].stopped, true);
  assert.equal(r[1].auto_reply, true);
  assert.equal(r[1].stopped, false);
  const [a, b] = await enrollmentsOf(c.id);
  assert.equal(a.status, "replied");
  assert.equal(b.status, "active"); // out-of-office does not stop the sequence
  assert.equal((await processInbound(db, mock.parseInbound(inbound), mock))[0].duplicate, true);
  const { rows } = await db.query(`SELECT 1 FROM tasks WHERE title LIKE 'Respond to email reply%' AND status = 'Pending'`);
  assert.ok(rows.length >= 1);
  await runEmailWorker(db, { now: at(3 * 1440 + 5), provider: mock });
  assert.equal(sent.filter((m) => m.to.email === sent[0].to.email).length, 1); // replied → no step 2
  assert.equal((await svc.campaignAnalytics(db, c.id)).replied, 1);
});

test("campaign pause, resume and cancel", async () => {
  const { c } = await activeCampaignWith(2, "Lifecycle");
  await db.tx((q) => svc.pauseCampaign(q, c.id, MEMBER));
  assert.equal((await runEmailWorker(db, { now: at(1), provider: mock })).claimed, 0);
  await db.tx((q) => svc.resumeCampaign(q, c.id, ADMIN, at(2)));
  assert.equal((await runEmailWorker(db, { now: at(3), provider: mock })).accepted, 2);
  await rejects(db.tx((q) => svc.activateCampaign(q, c.id, ADMIN, { confirm_recipients: 2 })), 409);
  await db.tx((q) => svc.cancelCampaign(q, c.id, ADMIN));
  assert.ok((await enrollmentsOf(c.id)).every((e) => e.status === "cancelled"));
  assert.equal((await runEmailWorker(db, { now: at(10 * 1440), provider: mock })).claimed, 0);
  assert.equal(sent.length, 2);
});

test("activation requires approval, recipients, and the exact recipient count", async () => {
  const c = await campaign("Activation guard");
  await rejects(db.tx((q) => svc.approveCampaign(q, c.id, ADMIN)), 422);
  const p = await prospect();
  await db.tx((q) => svc.enrollContacts(q, c.id, [p.contactId], ADMIN));
  await rejects(db.tx((q) => svc.activateCampaign(q, c.id, ADMIN, { confirm_recipients: 1 })), 409, /approved/);
  await db.tx((q) => svc.approveCampaign(q, c.id, ADMIN));
  await rejects(db.tx((q) => svc.activateCampaign(q, c.id, ADMIN, { confirm_recipients: 5 })), 400, /email 1 people/);
  // Placeholders block approval
  const c2 = await campaign("Placeholder", 1);
  const [s] = await svc.listSteps(db, c2.id);
  await db.tx((q) => svc.updateStep(q, c2.id, s.id, { text_template: "We saw [[their project]]." }, ADMIN));
  const p2 = await prospect();
  await db.tx((q) => svc.enrollContacts(q, c2.id, [p2.contactId], ADMIN));
  await rejects(db.tx((q) => svc.approveCampaign(q, c2.id, ADMIN)), 422);
  // Live activation refuses without provider configuration
  process.env.EMAIL_DRY_RUN = "false";
  try {
    await rejects(db.tx((q) => svc.activateCampaign(q, c.id, ADMIN, { confirm_recipients: 1 })), 409, /Live sending is not configured/);
  } finally {
    delete process.env.EMAIL_DRY_RUN;
  }
});

test("personalized drafts must be approved before they are sent", async () => {
  const { c } = await activeCampaignWith(1, "Personalized");
  const [e] = await enrollmentsOf(c.id);
  const [step] = await svc.listSteps(db, c.id);
  await db.query(`INSERT INTO email_personalized_drafts (enrollment_id, step_id, subject, text_body, source) VALUES ($1, $2, 'Custom subject', 'Custom body', 'ai')`, [e.id, step.id]);
  await runEmailWorker(db, { now: at(1), provider: mock });
  assert.equal(sent.length, 0);
  assert.equal((await enrollmentsOf(c.id))[0].stop_reason, "draft_pending");
  await db.query(`UPDATE email_personalized_drafts SET status = 'approved' WHERE enrollment_id = $1`, [e.id]);
  await db.query(`UPDATE email_sequence_enrollments SET status = 'active', stop_reason = NULL WHERE id = $1`, [e.id]);
  await runEmailWorker(db, { now: at(2), provider: mock });
  assert.equal(sent[0].subject, "Custom subject");
});

test("AI drafts: uses CRM facts, flags unverified figures, never sends", async () => {
  const p = await prospect({ name: "Dr. Meera Rao" });
  const c = await campaign("AI", 1);
  let prompt = "";
  setDraftGenerator(async (pr) => {
    prompt = pr;
    return JSON.stringify({ subject: "Water audit for your hospital", text_body: "Dear Meera, your 500 KLD plant [[site name]]…", facts_used: ["Organization"], hypotheses: [], placeholders: [] });
  });
  const d = await generateDraft(db, { campaign: { name: c.name, description: c.description }, steps: await svc.listSteps(db, c.id), stepOrder: 1, contactId: p.contactId, sender: { name: "S", company: null } });
  assert.match(prompt, /Dr\. Meera Rao/);
  assert.match(prompt, /Never invent/);
  assert.ok(d.warnings.some((w) => /500/.test(w)));
  assert.deepEqual(d.placeholders, ["site name"]);
  assert.equal(sent.length, 0);
  assert.throws(() => checkDraft({ subject: "", text_body: "" }, { mode: "template", campaign: { name: "", description: null }, step: { order: 1, total: 1, purpose: null, previous_subjects: [] }, facts: { verified: [], inferred: [], history: [] }, sender: { name: null, company: null } }));
  setDraftGenerator(null);
});

test("Brevo provider: request shape and error classification (mocked fetch)", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const responses = [new Response(JSON.stringify({ messageId: "<abc@relay>" }), { status: 201 }), new Response(JSON.stringify({ code: "invalid_parameter", message: "bad" }), { status: 400 }), new Response("", { status: 429 }), new Response("", { status: 502 })];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses.shift()!;
  }) as unknown as typeof fetch;
  const p = createBrevoProvider({ ...emailConfig(), brevoApiKey: "key-123" }, fakeFetch);
  const msg: OutboundEmail = { to: { email: "a@b.example" }, from: { email: "s@x.example", name: "S" }, subject: "Hi", html: "<p>Hi</p>", text: "Hi", reference: "wsis-msg-1" };
  assert.deepEqual(await p.send(msg), { status: "accepted", providerMessageId: "<abc@relay>" });
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal((calls[0].init.headers as Record<string, string>)["api-key"], "key-123");
  assert.equal(body.headers["X-Mailin-custom"], "wsis-msg-1");
  assert.equal((await p.send(msg)).status, "permanent");
  assert.equal((await p.send(msg)).status, "transient");
  assert.equal((await p.send(msg)).status, "ambiguous");
  const timeout = createBrevoProvider({ ...emailConfig(), brevoApiKey: "k" }, (async () => {
    throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
  }) as unknown as typeof fetch);
  assert.equal((await timeout.send(msg)).status, "ambiguous");
  const refused = createBrevoProvider({ ...emailConfig(), brevoApiKey: "k" }, (async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
  }) as unknown as typeof fetch);
  assert.equal((await refused.send(msg)).status, "transient");
});

test("HTTP: authentication and role checks on the email API", async () => {
  const { emailRouter } = await import("../routes/email");
  const app = express();
  app.use(express.json());
  app.use("/api/email", emailRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/email`;
  try {
    const call = (method: string, p: string, user?: number, body?: object, headers: Record<string, string> = {}) =>
      fetch(base + p, { method, headers: { "content-type": "application/json", ...(user ? { "x-user-id": String(user) } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await call("GET", "/campaigns")).status, 401);
    assert.equal((await call("GET", "/campaigns", 99999)).status, 401);
    assert.equal((await call("POST", "/campaigns", undefined, { name: "x" })).status, 401);
    const created = await call("POST", "/campaigns", MEMBER, { name: "Via HTTP" });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await call("POST", `/campaigns/${id}/approve`, MEMBER)).status, 403);
    assert.equal((await call("POST", `/campaigns/${id}/activate`, MEMBER, { confirm_recipients: 0 })).status, 403);
    assert.equal((await call("POST", `/campaigns/${id}/test-email`, MEMBER, { step_id: 1, to: "a@b.example" })).status, 403);
    assert.equal((await call("POST", `/campaigns/${id}/approve`, ADMIN)).status, 422); // allowed, but not ready
    assert.equal((await call("POST", `/campaigns/${id}/cancel`, MEMBER, {})).status, 400); // confirmation required
    // Recipient selection endpoint: filters, select-all ids, validation
    const sel = await (await call("GET", `/campaigns/${id}/eligible-contacts?eligibility=eligible&include_ids=true&limit=5`, MEMBER)).json();
    assert.ok(Array.isArray(sel.items) && Array.isArray(sel.eligible_ids));
    assert.ok(sel.items.every((x: { eligible: boolean }) => x.eligible));
    assert.equal(typeof sel.eligible_total, "number");
    assert.equal((await call("GET", `/campaigns/${id}/eligible-contacts?eligibility=bogus`, MEMBER)).status, 400);
    assert.equal((await call("GET", `/campaigns/${id}/eligible-contacts`)).status, 401);
    const enr = await (await call("POST", `/campaigns/${id}/enrollments`, MEMBER, { contact_ids: sel.eligible_ids.slice(0, 2) })).json();
    assert.equal(enr.enrolled, Math.min(2, sel.eligible_ids.length));
    assert.equal((await call("POST", `/campaigns/${id}/enrollments`, MEMBER, { contact_ids: ["x"] })).status, 400);
    const status = await (await call("GET", "/status", MEMBER)).json();
    assert.equal(status.mode, "dry_run");
    assert.equal(status.can_approve, false);
    assert.ok(!JSON.stringify(status).includes("secret"));
    // Webhooks require the shared token
    assert.equal((await call("POST", "/webhooks/brevo", undefined, { event: "delivered" })).status, 401);
    assert.equal((await call("POST", "/webhooks/brevo", undefined, { event: "delivered" }, { authorization: "Bearer wrong" })).status, 401);
    assert.equal((await call("POST", "/webhooks/brevo", undefined, { event: "delivered", email: "n@x.example" }, { authorization: "Bearer secret-token" })).status, 200);
    // Unsubscribe GET only shows a confirmation page
    const page = await call("GET", "/unsubscribe/abcdefghijklmnopqrstuvwxyz");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<form method="post">/);
    assert.equal((await call("POST", "/unsubscribe/abcdefghijklmnopqrstuvwxyz")).status, 404);
  } finally {
    server.close();
  }
});

/* ---------- recipient selection */

test("recipient selection: search, eligibility filter, counts, select-all ids, and clear reasons", async () => {
  const c = await campaign("Selection");
  const ok1 = await prospect({ name: "Qwerty Alpha" });
  const ok2 = await prospect({ name: "Qwerty Beta" });
  const noEmail = await prospect({ name: "Qwerty Gamma", email: null });
  const bad = await prospect({ name: "Qwerty Delta", email: "not-an-email" });
  const unsub = await prospect({ name: "Qwerty Epsilon", email: "qwerty.unsub@x.example" });
  const lost = await prospect({ name: "Qwerty Zeta", crmStatus: "Lost" });
  await db.tx((q) => svc.suppressEmail(q, "qwerty.unsub@x.example", "unsubscribed", "test"));

  const all = await svc.eligibleContacts(db, c.id, { search: "qwerty", includeIds: true, limit: 50, offset: 0 });
  assert.equal(all.total, 6);
  assert.equal(all.eligible_total, 2);
  assert.equal(all.ineligible_total, 4);
  assert.ok(all.crm_contacts >= 6);
  assert.deepEqual([...all.eligible_ids!].sort(), [ok1.contactId, ok2.contactId].sort());
  const reason = (id: number) => all.items.find((x) => x.contact_id === id)!.reasons.join("; ");
  assert.match(reason(noEmail.contactId), /No email address/);
  assert.match(reason(bad.contactId), /Email address looks invalid/);
  assert.match(reason(unsub.contactId), /Suppressed: unsubscribed/);
  assert.match(reason(lost.contactId), /CRM status is Lost/);

  const eligible = await svc.eligibleContacts(db, c.id, { search: "qwerty", eligibility: "eligible", limit: 50, offset: 0 });
  assert.ok(eligible.items.every((x) => x.eligible));
  assert.equal(eligible.total, 2);
  assert.equal(eligible.eligible_ids, undefined); // only when asked for
  const ineligible = await svc.eligibleContacts(db, c.id, { search: "qwerty", eligibility: "ineligible", limit: 2, offset: 2 });
  assert.equal(ineligible.total, 4);
  assert.equal(ineligible.items.length, 2);
  assert.ok(ineligible.items.every((x) => !x.eligible));

  // Search covers email and organization name as well as contact name
  assert.equal((await svc.eligibleContacts(db, c.id, { search: "QWERTY.UNSUB@", limit: 50, offset: 0 })).total, 1);
  const orgName = (await db.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [ok1.orgId])).rows[0].name;
  assert.ok((await svc.eligibleContacts(db, c.id, { search: orgName, limit: 50, offset: 0 })).items.some((x) => x.contact_id === ok1.contactId));

  // Enrolled contacts flip to ineligible ("already enrolled")
  await db.tx((q) => svc.enrollContacts(q, c.id, [ok1.contactId], ADMIN));
  const after = await svc.eligibleContacts(db, c.id, { search: "qwerty", includeIds: true, limit: 50, offset: 0 });
  assert.deepEqual(after.eligible_ids, [ok2.contactId]);
  assert.match(after.items.find((x) => x.contact_id === ok1.contactId)!.reasons.join(), /Already enrolled/);
});

test("recipient selection: eligibility is re-checked on enrollment, not trusted from the list", async () => {
  const c = await campaign("Stale selection");
  const a = await prospect({ name: "Stale One", email: "stale.one@x.example" });
  const b = await prospect({ name: "Stale Two" });
  const page = await svc.eligibleContacts(db, c.id, { search: "stale", includeIds: true, limit: 50, offset: 0 });
  assert.equal(page.eligible_ids!.length, 2); // both looked eligible when the user selected them
  await db.tx((q) => svc.suppressEmail(q, "stale.one@x.example", "hard_bounce", "test")); // …then one bounced elsewhere
  await db.query(`UPDATE crm_opportunities SET status = 'Not Interested' WHERE id = $1`, [b.oppId]);
  const r = await db.tx((q) => svc.enrollContacts(q, c.id, page.eligible_ids!, ADMIN));
  assert.equal(r.enrolled, 0);
  const why = Object.fromEntries(r.skipped.map((s) => [s.contact_id, s.reasons.join("; ")]));
  assert.match(why[a.contactId], /Suppressed: email bounced/);
  assert.match(why[b.contactId], /CRM status is Not Interested/);
  void a;
});

test("recipient selection: eligibility is re-checked immediately before sending", async () => {
  const { c, ps } = await activeCampaignWith(3, "Pre-send recheck");
  await db.query(`UPDATE crm_opportunities SET status = 'Converted' WHERE id = $1`, [ps[0].oppId]); // CRM outcome
  await db.query(`UPDATE contacts SET email = 'changed@new.example' WHERE id = $1`, [ps[1].contactId]); // address changed in CRM
  const r = await runEmailWorker(db, { now: at(1), provider: mock });
  assert.equal(r.accepted, 1);
  assert.equal(sent.length, 1);
  const es = await enrollmentsOf(c.id);
  assert.equal(es[0].status, "cancelled");
  assert.match(es[0].stop_reason!, /CRM status changed to Converted/);
  assert.equal(es[1].status, "cancelled");
  assert.match(es[1].stop_reason!, /email address changed/);
  assert.equal(es[2].status, "active");
});

/* ---------- test recipients, sender name, repeated test requests */

const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(old)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
};

test("test recipients: EMAIL_TEST_RECIPIENTS and team addresses are authorized; anything else is refused with guidance", async () => {
  const c = await campaign("Test recipients", 1);
  const [step] = await svc.listSteps(db, c.id);
  const actor = { id: ADMIN, name: "Akash" };
  await withEnv({ EMAIL_TEST_RECIPIENTS: "shuzaifasamee@gmail.com, @qa.example" }, async () => {
    assert.deepEqual(await testRecipientStatus(db, "ShuzaifaSamee@gmail.com"), { email: "shuzaifasamee@gmail.com", authorized: true, via: "test_recipients", reason: "Authorized: listed in EMAIL_TEST_RECIPIENTS" });
    assert.equal((await testRecipientStatus(db, "anyone@qa.example")).via, "test_recipients"); // @domain entry
    assert.equal((await testRecipientStatus(db, "akash@team.example")).via, "team_member");
    const no = await testRecipientStatus(db, "stranger@gmail.com");
    assert.equal(no.authorized, false);
    assert.match(no.reason, /not an authorized test recipient \(EMAIL_TEST_RECIPIENTS does not include it\)/);
    assert.match(no.reason, /Settings → Team/);
    assert.equal((await testRecipientStatus(db, "a@b.example, c@d.example")).authorized, false); // one address only
    assert.equal((await testRecipientStatus(db, "not an email")).reason, "Enter a single valid email address.");

    const r = await sendTestEmail(db, { campaignId: c.id, stepId: step.id, to: "shuzaifasamee@gmail.com", actor, provider: mock });
    assert.equal(r.result.status, "accepted");
    assert.equal(r.mode, "dry_run"); // dry-run preserved
    assert.equal(sent.length, 1);
    await rejects(sendTestEmail(db, { campaignId: c.id, stepId: step.id, to: "stranger@gmail.com", actor, provider: mock }), 403, /EMAIL_TEST_RECIPIENTS/);
    await rejects(sendTestEmail(db, { campaignId: c.id, stepId: step.id, to: "nonsense", actor, provider: mock }), 400);
    assert.equal(sent.length, 1); // refused requests never reach the provider
  });
  await withEnv({ EMAIL_TEST_RECIPIENTS: undefined }, async () => {
    assert.match((await testRecipientStatus(db, "shuzaifasamee@gmail.com")).reason, /EMAIL_TEST_RECIPIENTS is not set/);
  });
});

test("test recipients: EMAIL_TEST_RECIPIENTS does not restrict sequences; EMAIL_RECIPIENT_ALLOWLIST restricts everything", async () => {
  const c = await campaign("Allowlists", 1);
  const p = await prospect({ name: "Allow Listed", email: "prospect@client.example" });
  await withEnv({ EMAIL_TEST_RECIPIENTS: "shuzaifasamee@gmail.com" }, async () => {
    const page = await svc.eligibleContacts(db, c.id, { search: "allow listed", limit: 5, offset: 0 });
    assert.equal(page.items[0].eligible, true); // a test-email allowlist must not block real prospects
  });
  await withEnv({ EMAIL_TEST_RECIPIENTS: "shuzaifasamee@gmail.com", EMAIL_RECIPIENT_ALLOWLIST: "@company.example" }, async () => {
    const page = await svc.eligibleContacts(db, c.id, { search: "allow listed", limit: 5, offset: 0 });
    assert.match(page.items[0].reasons.join(), /EMAIL_RECIPIENT_ALLOWLIST/);
    const t = await testRecipientStatus(db, "shuzaifasamee@gmail.com");
    assert.equal(t.authorized, false);
    assert.match(t.reason, /EMAIL_RECIPIENT_ALLOWLIST/);
  });
  void p;
});

test("sender name: {{sender.name}} resolves to EMAIL_SENDER_NAME, else 'WSIS Team' — never a missing value", async () => {
  const c = await db.tx((q) => svc.createCampaign(q, { name: "Sender name", settings: { send_window: null } }, ADMIN));
  for (const [i, body] of ["Intro\n\n{{sender.name}}", "Follow-up\n\n{{sender.name}}", "Meeting?\n\n{{sender.name}}"].entries()) {
    await db.tx((q) => svc.addStep(q, c.id, { subject_template: `Step ${i + 1}`, text_template: body, delay_minutes: i * 1440 }, ADMIN));
  }
  const p = await prospect();
  await db.tx((q) => svc.enrollContacts(q, c.id, [p.contactId], ADMIN));
  await withEnv({ EMAIL_SENDER_NAME: undefined }, async () => {
    const issues = await svc.approvalIssues(db, c.id);
    assert.ok(!issues.warnings.some((w) => /sender\.name/.test(w)), issues.warnings.join(" | "));
    for (const s of await svc.listSteps(db, c.id)) {
      const r = renderEmail({ subject: s.subject_template, text: s.text_template }, await svc.recipientVars(db, p.contactId), svc.footerInfo("t"));
      assert.deepEqual(r.missing, []);
      assert.match(r.text, /\n\nWSIS Team\n/);
    }
    await db.tx((q) => svc.approveCampaign(q, c.id, ADMIN));
    await db.tx((q) => svc.activateCampaign(q, c.id, ADMIN, { confirm_recipients: 1 }, T0));
    await runEmailWorker(db, { now: at(1), provider: mock });
    assert.equal(sent.length, 1); // not held for a missing value
    assert.match(sent[0].text, /WSIS Team/);
    assert.equal(sent[0].from.name, "WSIS Team");
  });
  await withEnv({ EMAIL_SENDER_NAME: "Huzaifa S" }, async () => {
    assert.equal((await svc.recipientVars(db, p.contactId))["sender.name"], "Huzaifa S");
  });
  // Explicit fallback syntax keeps working and the configured name wins over it
  const r = renderEmail({ subject: "s", text: "{{sender.name|Someone}}" }, { "sender.name": "Test Sender" }, svc.footerInfo("t"));
  assert.match(r.text, /^Test Sender/);
});

test("repeated test requests: one in flight per user, duplicates refused, provider called once", async () => {
  const c = await campaign("Repeat clicks", 1);
  const [step] = await svc.listSteps(db, c.id);
  handler = async () => {
    await new Promise((r) => setTimeout(r, 30));
    return { status: "accepted", providerMessageId: "<t@x>" };
  };
  const send = () => sendTestEmail(db, { campaignId: c.id, stepId: step.id, to: "akash@team.example", actor: { id: ADMIN, name: "Akash" }, provider: mock });
  const results = await Promise.allSettled([send(), send(), send()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.equal(refused.length, 2);
  assert.ok(refused.every((r) => r.reason instanceof HttpError && r.reason.status === 409 && /already being sent/.test(r.reason.message)));
  assert.equal(sent.length, 1);
  // Once finished, the next request goes through
  assert.equal((await send()).result.status, "accepted");
  assert.equal(sent.length, 2);
});

test("HTTP: recipient check endpoint, and rejected test requests do not exhaust the rate limit", async () => {
  const { emailRouter } = await import("../routes/email");
  const app = express();
  app.use(express.json());
  app.use("/api/email", emailRouter);
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.status ?? 500).json({ error: err.message }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/email`;
  const c = await campaign("HTTP test email", 1);
  const [step] = await svc.listSteps(db, c.id);
  try {
    await withEnv({ EMAIL_TEST_RECIPIENTS: "shuzaifasamee@gmail.com" }, async () => {
      const get = (to: string) => fetch(`${base}/test-recipient?to=${encodeURIComponent(to)}`, { headers: { "x-user-id": String(MEMBER) } }).then((r) => r.json());
      assert.equal((await get("shuzaifasamee@gmail.com")).authorized, true);
      assert.equal((await get("stranger@gmail.com")).authorized, false);
      const post = (to: string) =>
        fetch(`${base}/campaigns/${c.id}/test-email`, { method: "POST", headers: { "content-type": "application/json", "x-user-id": String(ADMIN) }, body: JSON.stringify({ step_id: step.id, to }) });
      // 12 unauthorized attempts (limit is 10/hour): each is a clear 403, never a 429
      for (let i = 0; i < 12; i++) {
        const r = await post("stranger@gmail.com");
        assert.equal(r.status, 403);
        assert.match((await r.json()).error, /not an authorized test recipient/);
      }
      const ok = await post("shuzaifasamee@gmail.com");
      assert.equal(ok.status, 200);
      assert.equal((await ok.json()).mode, "dry_run");
    });
  } finally {
    server.close();
  }
});
