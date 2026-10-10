import crypto from "node:crypto";
import type { Database, Queryable } from "../db";
import { HttpError } from "../lib/http";
import { logActivity } from "../lib/log";
import { advanceByMilestone, pipelineStages } from "../lib/crm";
import { normalizeEmail } from "../lib/normalize";
import type { SequenceStep } from "../../shared/email";
import { emailConfig, matchesList, recipientAllowed, senderDisplayName, type EmailConfig } from "./config";
import { getEmailProvider, type EmailProvider, type OutboundEmail, type SendResult } from "./provider";
import { renderEmail } from "./template";
import { campaignSettings, contentFor, footerInfo, nextActiveStep, recipientVars, scheduleAfter, sentToday, stopEnrollment, suppressionFor } from "./service";

/**
 * Email worker. One tick:
 *   1. promotes scheduled campaigns whose start time has passed,
 *   2. atomically claims a batch of due enrollments (lease via claim_token/claimed_at, FOR UPDATE SKIP LOCKED),
 *   3. for each: re-checks eligibility in a short transaction and creates the email_messages row
 *      (UNIQUE enrollment × step = duplicate-send guard), then calls the provider OUTSIDE any transaction,
 *      then records the outcome in a second short transaction,
 *   4. marks campaigns with no live enrollments as completed.
 */

export const messageReference = (messageId: number) => `wsis-msg-${messageId}`;
export const parseMessageReference = (ref: string | null) => {
  const m = ref?.match(/^wsis-msg-(\d+)$/);
  return m ? Number(m[1]) : null;
};

export function replyAddress(replyToken: string, c: EmailConfig = emailConfig()): string | null {
  return c.replyDomain ? `reply-${replyToken}@${c.replyDomain}` : null;
}

function buildOutbound(
  c: EmailConfig,
  r: { to: string; name: string | null; subject: string; html: string; text: string; reference: string; unsubscribeUrl: string | null; replyToken: string | null; campaignId: number | null },
): OutboundEmail {
  const headers: Record<string, string> = {};
  if (r.unsubscribeUrl && c.listUnsubscribeHeader) {
    headers["List-Unsubscribe"] = `<${r.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  const reply = r.replyToken ? replyAddress(r.replyToken, c) : null;
  return {
    to: { email: r.to, name: r.name },
    from: { email: c.senderEmail ?? "dry-run@wsis.local", name: senderDisplayName(c) },
    replyTo: reply ? { email: reply, name: senderDisplayName(c) } : null,
    subject: r.subject,
    html: r.html,
    text: r.text,
    headers,
    reference: r.reference,
    tags: ["wsis-outreach", ...(r.campaignId ? [`campaign-${r.campaignId}`] : [])],
  };
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 500);

async function event(
  q: Queryable,
  e: { campaignId: number | null; enrollmentId: number | null; stepId: number | null; messageId?: number | null; type: string; attempt?: number | null; provider?: string | null; providerMessageId?: string | null; email?: string | null; metadata?: object; dedupeKey?: string | null; occurredAt?: string | null },
) {
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO email_send_events (campaign_id, enrollment_id, step_id, message_id, event_type, attempt_number, provider, provider_message_id, email, metadata, dedupe_key, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12::timestamptz, now()))
     ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
    [e.campaignId, e.enrollmentId, e.stepId, e.messageId ?? null, e.type, e.attempt ?? null, e.provider ?? null, e.providerMessageId ?? null, e.email ?? null, JSON.stringify(e.metadata ?? {}), e.dedupeKey ?? null, e.occurredAt ?? null],
  );
  return rows.length > 0;
}
export { event as recordEmailEvent };

/** Claim up to `limit` due enrollments. Concurrent workers never claim the same row while its lease is valid. */
export async function claimDue(db: Database, opts: { now: Date; limit: number; mode: string; leaseMs: number; token: string }): Promise<number[]> {
  if (opts.limit <= 0) return [];
  return db.tx(async (q) => {
    const { rows } = await q.query<{ id: number }>(
      `UPDATE email_sequence_enrollments e SET claim_token = $1, claimed_at = $2
        WHERE e.id IN (
          SELECT e2.id FROM email_sequence_enrollments e2 JOIN email_campaigns c ON c.id = e2.campaign_id
           WHERE e2.status = 'active' AND c.status = 'active' AND c.send_mode = $3
             AND e2.next_send_at <= $2
             AND (e2.claim_token IS NULL OR e2.claimed_at < $2::timestamptz - ($4::int * interval '1 millisecond'))
           ORDER BY e2.next_send_at, e2.id
           LIMIT $5
           FOR UPDATE OF e2 SKIP LOCKED)
          AND (e.claim_token IS NULL OR e.claimed_at < $2::timestamptz - ($4::int * interval '1 millisecond'))
        RETURNING e.id`,
      [opts.token, opts.now.toISOString(), opts.mode, opts.leaseMs, opts.limit],
    );
    return rows.map((r) => r.id).sort((a, b) => a - b);
  });
}

type Prepared =
  | { kind: "skip" }
  | {
      kind: "send";
      messageId: number;
      attempt: number;
      step: SequenceStep;
      campaignId: number;
      enrollmentId: number;
      organizationId: number | null;
      opportunityId: number | null;
      campaignName: string;
      outbound: OutboundEmail;
    };

const release = (q: Queryable, id: number, extra = "", params: unknown[] = []) =>
  q.query(`UPDATE email_sequence_enrollments SET claim_token = NULL, claimed_at = NULL, updated_at = now()${extra} WHERE id = $1`, [id, ...params]);

const holdEnrollment = (q: Queryable, id: number, reason: string, error: string) =>
  q.query(`UPDATE email_sequence_enrollments SET status = 'paused', stop_reason = $2, last_error = $3, claim_token = NULL, claimed_at = NULL, updated_at = now() WHERE id = $1`, [id, reason, error]);

/** Re-check everything right before sending and reserve the message row. Short transaction, no network. */
async function prepare(db: Database, enrollmentId: number, claimToken: string, cfg: EmailConfig, provider: EmailProvider, now: Date): Promise<Prepared> {
  return db.tx(async (q) => {
    const { rows } = await q.query<any>(
      `SELECT e.*, c.status AS campaign_status, c.send_mode, c.name AS campaign_name, c.settings,
              ct.email AS contact_email, org.merged_into, o.status AS crm_status, ps.kind AS stage_kind
         FROM email_sequence_enrollments e
         JOIN email_campaigns c ON c.id = e.campaign_id
         LEFT JOIN contacts ct ON ct.id = e.contact_id
         LEFT JOIN organizations org ON org.id = e.organization_id
         LEFT JOIN crm_opportunities o ON o.id = e.opportunity_id
         LEFT JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
        WHERE e.id = $1 FOR UPDATE OF e`,
      [enrollmentId],
    );
    const e = rows[0];
    if (!e || e.claim_token !== claimToken) return { kind: "skip" }; // lease lost to another worker
    if (e.status !== "active" || e.campaign_status !== "active" || e.send_mode !== cfg.mode) {
      await release(q, e.id);
      return { kind: "skip" };
    }
    const settings = campaignSettings(e.settings);

    // Stop conditions
    const sup = await suppressionFor(q, e.email);
    if (sup) {
      await stopEnrollment(q, e.id, sup.reason === "unsubscribed" || sup.reason === "complaint" ? "unsubscribed" : sup.reason === "manual" ? "cancelled" : "bounced", `Suppressed (${sup.reason})`);
      return { kind: "skip" };
    }
    if (e.contact_id && (!e.contact_email || normalizeEmail(e.contact_email) !== e.email)) {
      await stopEnrollment(q, e.id, "cancelled", "Contact's email address changed or was removed in the CRM");
      return { kind: "skip" };
    }
    if (e.merged_into) {
      await stopEnrollment(q, e.id, "cancelled", "Organization was merged into another record");
      return { kind: "skip" };
    }
    if (e.crm_status && (settings.stop_on_crm_statuses.includes(e.crm_status) || (e.stage_kind && e.stage_kind !== "open"))) {
      await stopEnrollment(q, e.id, "cancelled", `CRM status changed to ${e.crm_status}`);
      return { kind: "skip" };
    }
    if (!recipientAllowed(e.email, cfg)) {
      await holdEnrollment(q, e.id, "test_restriction", "Recipient is outside EMAIL_RECIPIENT_ALLOWLIST");
      return { kind: "skip" };
    }
    const step = await nextActiveStep(q, e.campaign_id, e.current_step);
    if (!step) {
      await stopEnrollment(q, e.id, "completed", "All steps sent");
      return { kind: "skip" };
    }
    const content = await contentFor(q, e.id, step);
    if (content.pendingDraft) {
      await holdEnrollment(q, e.id, "draft_pending", `Personalized draft for step ${step.step_order} is awaiting review`);
      return { kind: "skip" };
    }
    const vars = await recipientVars(q, e.contact_id, { name: e.recipient_name });
    const footer = footerInfo(e.unsubscribe_token);
    const rendered = renderEmail(content, vars, footer);
    if (rendered.placeholders.length) {
      await holdEnrollment(q, e.id, "content_incomplete", `Step ${step.step_order} still contains placeholders: ${rendered.placeholders.join(", ")}`);
      return { kind: "skip" };
    }
    if (rendered.missing.length) {
      await holdEnrollment(q, e.id, "content_incomplete", `No value for ${rendered.missing.map((m) => `{{${m}}}`).join(", ")} in step ${step.step_order}; add a fallback or fill the CRM field`);
      return { kind: "skip" };
    }

    // Reserve the logical message. The unique key means only one row can ever exist per enrollment × step.
    let messageId: number;
    let attempt = 1;
    const ins = await q.query<{ id: number }>(
      `INSERT INTO email_messages (campaign_id, enrollment_id, step_id, status, send_mode, provider, subject)
       VALUES ($1, $2, $3, 'sending', $4, $5, $6) ON CONFLICT (enrollment_id, step_id) DO NOTHING RETURNING id`,
      [e.campaign_id, e.id, step.id, cfg.mode, provider.name, rendered.subject],
    );
    if (ins.rows[0]) messageId = ins.rows[0].id;
    else {
      const { rows: ex } = await q.query<{ id: number; status: string; attempts: number }>(`SELECT id, status, attempts FROM email_messages WHERE enrollment_id = $1 AND step_id = $2`, [e.id, step.id]);
      const m = ex[0];
      if (m.status === "sent") {
        // Recovered after a crash between send and bookkeeping: advance without resending.
        await advanceAfterSend(q, e.id, e.campaign_id, step, settings.send_window, now);
        return { kind: "skip" };
      }
      if (m.status === "sending" || m.status === "ambiguous") {
        await q.query(`UPDATE email_messages SET status = 'ambiguous', updated_at = now() WHERE id = $1`, [m.id]);
        await holdEnrollment(q, e.id, "ambiguous_send", "A previous attempt for this step did not finish; it may have been sent. Check the provider's logs, then resume.");
        await event(q, { campaignId: e.campaign_id, enrollmentId: e.id, stepId: step.id, messageId: m.id, type: "ambiguous", provider: provider.name, metadata: { reason: "attempt interrupted" } });
        return { kind: "skip" };
      }
      if (m.status === "failed_permanent") {
        await stopEnrollment(q, e.id, "failed", "Permanent send failure");
        return { kind: "skip" };
      }
      const upd = await q.query<{ attempts: number }>(
        `UPDATE email_messages SET status = 'sending', attempts = attempts + 1, subject = $2, updated_at = now() WHERE id = $1 AND status = 'failed_transient' RETURNING attempts`,
        [m.id, rendered.subject],
      );
      if (!upd.rows[0]) return { kind: "skip" };
      messageId = m.id;
      attempt = upd.rows[0].attempts;
    }
    await event(q, { campaignId: e.campaign_id, enrollmentId: e.id, stepId: step.id, messageId, type: "attempt", attempt, provider: provider.name, email: e.email, metadata: { mode: cfg.mode, personalized: content.personalized } });
    return {
      kind: "send",
      messageId,
      attempt,
      step,
      campaignId: e.campaign_id,
      enrollmentId: e.id,
      organizationId: e.organization_id,
      opportunityId: e.opportunity_id,
      campaignName: e.campaign_name,
      outbound: buildOutbound(cfg, {
        to: e.email,
        name: e.recipient_name,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        reference: messageReference(messageId),
        unsubscribeUrl: footer.unsubscribeUrl,
        replyToken: e.reply_token,
        campaignId: e.campaign_id,
      }),
    };
  });
}

async function advanceAfterSend(q: Queryable, enrollmentId: number, campaignId: number, step: SequenceStep, window: Parameters<typeof scheduleAfter>[2], now: Date) {
  const next = await nextActiveStep(q, campaignId, step.step_order);
  if (next) {
    await q.query(
      `UPDATE email_sequence_enrollments SET current_step = $2, next_send_at = $3, attempt_count = 0, last_error = NULL,
              status = CASE WHEN status = 'paused' AND stop_reason = 'ambiguous_send' THEN 'active' ELSE status END,
              stop_reason = CASE WHEN stop_reason = 'ambiguous_send' THEN NULL ELSE stop_reason END,
              claim_token = NULL, claimed_at = NULL, updated_at = now()
        WHERE id = $1 AND status IN ('active', 'paused')`,
      [enrollmentId, step.step_order, scheduleAfter(now, next.delay_minutes, window).toISOString()],
    );
  } else {
    await q.query(`UPDATE email_sequence_enrollments SET current_step = $2, last_error = NULL WHERE id = $1`, [enrollmentId, step.step_order]);
    await stopEnrollment(q, enrollmentId, "completed", "All steps sent");
  }
}

/** A provider event proved an ambiguous message was accepted: advance the held enrollment as if the send had succeeded. */
export async function reconcileAcceptedMessage(q: Queryable, messageId: number, now = new Date()) {
  const { rows } = await q.query<SequenceStep & { enrollment_id: number; settings: any; enrollment_status: string; stop_reason: string | null }>(
    `SELECT s.*, m.enrollment_id, c.settings, e.status AS enrollment_status, e.stop_reason
       FROM email_messages m JOIN email_sequence_steps s ON s.id = m.step_id JOIN email_campaigns c ON c.id = m.campaign_id
       JOIN email_sequence_enrollments e ON e.id = m.enrollment_id WHERE m.id = $1`,
    [messageId],
  );
  const r = rows[0];
  if (!r || r.enrollment_status !== "paused" || r.stop_reason !== "ambiguous_send") return;
  await advanceAfterSend(q, r.enrollment_id, r.campaign_id, r, campaignSettings(r.settings).send_window, now);
}

export function backoffMs(attempt: number, baseMs: number) {
  return Math.min(baseMs * 2 ** (attempt - 1), 24 * 3600 * 1000);
}

/** Record the provider's answer. Short transaction; runs even if our lease expired, because it is the truth. */
async function record(db: Database, p: Extract<Prepared, { kind: "send" }>, result: SendResult, cfg: EmailConfig, providerName: string, now: Date) {
  await db.tx(async (q) => {
    const { rows } = await q.query<{ settings: any; status: string }>(
      `SELECT c.settings, e.status FROM email_sequence_enrollments e JOIN email_campaigns c ON c.id = e.campaign_id WHERE e.id = $1 FOR UPDATE OF e`,
      [p.enrollmentId],
    );
    const settings = campaignSettings(rows[0]?.settings);
    const base = { campaignId: p.campaignId, enrollmentId: p.enrollmentId, stepId: p.step.id, messageId: p.messageId, attempt: p.attempt, provider: providerName, email: p.outbound.to.email };

    if (result.status === "accepted") {
      await q.query(`UPDATE email_messages SET status = 'sent', provider_message_id = $2, sent_at = $3, last_error = NULL, updated_at = now() WHERE id = $1`, [p.messageId, result.providerMessageId, now.toISOString()]);
      await event(q, { ...base, type: cfg.mode === "dry_run" ? "dry_run_accepted" : "accepted", providerMessageId: result.providerMessageId });
      await advanceAfterSend(q, p.enrollmentId, p.campaignId, p.step, settings.send_window, now);
      if (p.organizationId) {
        await logActivity(q, {
          organizationId: p.organizationId,
          opportunityId: p.opportunityId,
          type: "email_sent",
          summary: `${cfg.mode === "dry_run" ? "[Dry run] " : ""}Email “${p.outbound.subject}” sent to ${p.outbound.to.email} (campaign “${p.campaignName}”, step ${p.step.step_order})`,
          details: { campaign_id: p.campaignId, enrollment_id: p.enrollmentId, message_id: p.messageId, step: p.step.step_order, mode: cfg.mode },
          occurredAt: now.toISOString(),
        });
        if (p.opportunityId && cfg.mode === "live") {
          const { rows: o } = await q.query<{ status: string; pipeline: string; organization_id: number }>(`SELECT status, pipeline, organization_id FROM crm_opportunities WHERE id = $1`, [p.opportunityId]);
          if (o[0]) {
            // Same rule as a logged interaction: move forward to the pipeline's "contacted" milestone only.
            const status = advanceByMilestone(await pipelineStages(q, o[0].pipeline), o[0].status, "contacted");
            await q.query(`UPDATE crm_opportunities SET last_contact_at = $2, status = $3, updated_at = now() WHERE id = $1`, [p.opportunityId, now.toISOString(), status]);
            if (status !== o[0].status) {
              await logActivity(q, { organizationId: o[0].organization_id, opportunityId: p.opportunityId, type: "status_change", summary: `Status changed: ${o[0].status} → ${status}`, details: { from: o[0].status, to: status, automatic: true, source: "email" } });
            }
          }
        }
      }
      return;
    }

    const error = result.error;
    if (result.status === "ambiguous") {
      await q.query(`UPDATE email_messages SET status = 'ambiguous', last_error = $2, updated_at = now() WHERE id = $1`, [p.messageId, error]);
      await event(q, { ...base, type: "ambiguous", metadata: { error, http_status: result.httpStatus ?? null } });
      await q.query(
        `UPDATE email_sequence_enrollments SET status = 'paused', stop_reason = 'ambiguous_send', last_error = $2, claim_token = NULL, claimed_at = NULL, updated_at = now() WHERE id = $1 AND status = 'active'`,
        [p.enrollmentId, error],
      );
      return;
    }
    if (result.status === "transient" && p.attempt < cfg.maxAttempts) {
      const retryAt = new Date(now.getTime() + backoffMs(p.attempt, cfg.retryBaseMs));
      await q.query(`UPDATE email_messages SET status = 'failed_transient', last_error = $2, updated_at = now() WHERE id = $1`, [p.messageId, error]);
      await event(q, { ...base, type: "failed_transient", metadata: { error, http_status: result.httpStatus ?? null, retry_at: retryAt.toISOString() } });
      await release(q, p.enrollmentId, ", attempt_count = $2, last_error = $3, next_send_at = $4", [p.attempt, error, retryAt.toISOString()]);
      return;
    }
    const finalError = result.status === "transient" ? `Gave up after ${p.attempt} attempts: ${error}` : error;
    await q.query(`UPDATE email_messages SET status = 'failed_permanent', last_error = $2, updated_at = now() WHERE id = $1`, [p.messageId, finalError]);
    await event(q, { ...base, type: "failed_permanent", metadata: { error: finalError, http_status: result.httpStatus ?? null } });
    await q.query(`UPDATE email_sequence_enrollments SET last_error = $2, attempt_count = $3 WHERE id = $1`, [p.enrollmentId, finalError, p.attempt]);
    await stopEnrollment(q, p.enrollmentId, "failed", "Send failed");
  });
}

export interface WorkerResult {
  claimed: number;
  attempted: number;
  accepted: number;
  failed: number;
  skipped: number;
  dailyLimitReached: boolean;
}

export async function runEmailWorker(db: Database, opts: { now?: Date; provider?: EmailProvider; limit?: number } = {}): Promise<WorkerResult> {
  const now = opts.now ?? new Date();
  const cfg = emailConfig();
  const provider = opts.provider ?? getEmailProvider(cfg);
  const out: WorkerResult = { claimed: 0, attempted: 0, accepted: 0, failed: 0, skipped: 0, dailyLimitReached: false };

  await db.query(`UPDATE email_campaigns SET status = 'active', updated_at = now() WHERE status = 'scheduled' AND scheduled_start_at <= $1`, [now.toISOString()]);

  const remaining = Math.max(0, cfg.dailySendLimit - (await sentToday(db, cfg.mode, now)));
  const limit = Math.min(opts.limit ?? cfg.batchSize, remaining);
  if (remaining === 0) out.dailyLimitReached = true;

  const token = crypto.randomUUID();
  const ids = await claimDue(db, { now, limit, mode: cfg.mode, leaseMs: cfg.leaseMs, token });
  out.claimed = ids.length;
  for (const id of ids) {
    let p: Prepared;
    try {
      p = await prepare(db, id, token, cfg, provider, now);
    } catch (e) {
      console.error(`[email] prepare failed for enrollment ${id}:`, errText(e));
      await db.query(`UPDATE email_sequence_enrollments SET claim_token = NULL, claimed_at = NULL, last_error = $2 WHERE id = $1 AND claim_token = $3`, [id, errText(e), token]).catch(() => undefined);
      out.skipped++;
      continue;
    }
    if (p.kind === "skip") {
      out.skipped++;
      continue;
    }
    out.attempted++;
    let result: SendResult;
    try {
      result = await provider.send(p.outbound);
    } catch (e) {
      result = { status: "ambiguous", error: `Provider error: ${errText(e)}` };
    }
    if (result.status === "accepted") out.accepted++;
    else out.failed++;
    try {
      await record(db, p, result, cfg, provider.name, now);
    } catch (e) {
      // The message row stays 'sending', so the next attempt treats it as ambiguous instead of resending.
      console.error(`[email] could not record result for message ${p.messageId}:`, errText(e));
    }
  }

  await db.query(
    `UPDATE email_campaigns c SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE c.status = 'active' AND NOT EXISTS (SELECT 1 FROM email_sequence_enrollments e WHERE e.campaign_id = c.id AND e.status IN ('pending', 'active', 'paused'))`,
  );
  return out;
}

/* ------------------------------------------------------------------ test email */

export interface TestRecipientStatus {
  email: string | null;
  authorized: boolean;
  via: "team_member" | "test_recipients" | null;
  reason: string;
}

/**
 * Who may receive a test email: an active team member's address (Settings → Team) or an address / @domain in
 * EMAIL_TEST_RECIPIENTS — and, if EMAIL_RECIPIENT_ALLOWLIST is set, it must match that too. Anything else is refused.
 */
export async function testRecipientStatus(q: Queryable, raw: unknown, c: EmailConfig = emailConfig()): Promise<TestRecipientStatus> {
  const email = normalizeEmail(raw);
  if (!email || email !== String(raw).trim().toLowerCase()) return { email: null, authorized: false, via: null, reason: "Enter a single valid email address." };
  const { rows } = await q.query<{ name: string }>(`SELECT name FROM users WHERE active AND lower(email) = $1 LIMIT 1`, [email]);
  const via = rows[0] ? "team_member" : matchesList(email, c.testRecipients) ? "test_recipients" : null;
  if (!via) {
    const hint = c.testRecipients.length ? "EMAIL_TEST_RECIPIENTS does not include it" : "EMAIL_TEST_RECIPIENTS is not set";
    return {
      email,
      authorized: false,
      via: null,
      reason: `${email} is not an authorized test recipient (${hint}). Add it to EMAIL_TEST_RECIPIENTS in the server's .env and restart the API, or use a team member's email address (Settings → Team).`,
    };
  }
  if (!recipientAllowed(email, c)) return { email, authorized: false, via: null, reason: `${email} is outside EMAIL_RECIPIENT_ALLOWLIST, which restricts every email this server sends.` };
  return { email, authorized: true, via, reason: via === "team_member" ? `Authorized: ${rows[0].name}'s team address` : "Authorized: listed in EMAIL_TEST_RECIPIENTS" };
}

/** One test email at a time per user, so repeated clicks or double submits cannot send duplicates. */
const testsInFlight = new Set<number>();

export async function sendTestEmail(
  db: Database,
  opts: { campaignId: number; stepId: number; to: string; contactId?: number | null; actor: { id: number; name: string }; provider?: EmailProvider },
) {
  if (testsInFlight.has(opts.actor.id)) throw new HttpError(409, "A test email is already being sent. Wait for it to finish.");
  testsInFlight.add(opts.actor.id);
  try {
    return await sendTestEmailNow(db, opts);
  } finally {
    testsInFlight.delete(opts.actor.id);
  }
}

async function sendTestEmailNow(
  db: Database,
  opts: { campaignId: number; stepId: number; to: string; contactId?: number | null; actor: { id: number; name: string }; provider?: EmailProvider },
) {
  const cfg = emailConfig();
  const check = await testRecipientStatus(db, opts.to, cfg);
  if (!check.authorized) throw new HttpError(check.email ? 403 : 400, check.reason, { authorized: false });
  const to = check.email!;
  const { rows: steps } = await db.query<SequenceStep>(`SELECT * FROM email_sequence_steps WHERE id = $1 AND campaign_id = $2`, [opts.stepId, opts.campaignId]);
  if (!steps[0]) throw new HttpError(404, "Step not found");
  const vars = await recipientVars(db, opts.contactId ?? null, { name: null });
  const rendered = renderEmail({ subject: steps[0].subject_template, text: steps[0].text_template, html: steps[0].html_template }, vars, footerInfo("test-email"));
  const provider = opts.provider ?? getEmailProvider(cfg);
  const outbound = buildOutbound(cfg, {
    to,
    name: null,
    subject: `[TEST] ${rendered.subject}`,
    html: rendered.html,
    text: rendered.text,
    reference: `wsis-test-${opts.campaignId}-${Date.now()}`,
    unsubscribeUrl: null,
    replyToken: null,
    campaignId: opts.campaignId,
  });
  let result: SendResult;
  try {
    result = await provider.send(outbound);
  } catch (e) {
    result = { status: "ambiguous", error: errText(e) };
  }
  await event(db, {
    campaignId: opts.campaignId,
    enrollmentId: null,
    stepId: opts.stepId,
    type: result.status === "accepted" ? "test_sent" : "test_failed",
    provider: provider.name,
    providerMessageId: result.status === "accepted" ? result.providerMessageId : null,
    email: to,
    metadata: { mode: cfg.mode, by: opts.actor.name, ...(result.status !== "accepted" ? { error: result.error } : {}), missing: rendered.missing, placeholders: rendered.placeholders },
  });
  return { result, mode: cfg.mode, missing: rendered.missing, placeholders: rendered.placeholders, to };
}

/* ------------------------------------------------------------------ lifecycle */

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;
let stopped = true;

export const schedulerRunning = () => !stopped;

/** Start the background worker once per process. Ticks never overlap (setTimeout chain, not setInterval). */
export function startEmailScheduler(db: Database) {
  const cfg = emailConfig();
  if (!cfg.schedulerEnabled) {
    console.log("[email] scheduler disabled (EMAIL_SCHEDULER_ENABLED=false)");
    return;
  }
  if (!stopped) return;
  stopped = false;
  console.log(`[email] scheduler started — ${cfg.mode === "dry_run" ? "DRY RUN (nothing leaves the server)" : "LIVE sending via " + cfg.provider}, every ${cfg.schedulerIntervalMs / 1000}s`);
  const loop = async () => {
    if (stopped) return;
    running = runEmailWorker(db)
      .then((r) => {
        if (r.attempted || r.dailyLimitReached) console.log(`[email] tick: ${r.accepted} accepted, ${r.failed} failed, ${r.skipped} skipped${r.dailyLimitReached ? " (daily limit reached)" : ""}`);
      })
      .catch((e) => console.error("[email] worker error:", errText(e)));
    await running;
    running = null;
    if (!stopped) timer = setTimeout(loop, emailConfig().schedulerIntervalMs);
  };
  timer = setTimeout(loop, 5000);
}

/** Stop scheduling new ticks and wait (bounded) for the current one to finish. */
export async function stopEmailScheduler(timeoutMs = 30000) {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  if (running) await Promise.race([running, new Promise((r) => setTimeout(r, timeoutMs))]);
}
