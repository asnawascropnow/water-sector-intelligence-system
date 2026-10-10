import { Router, type Request } from "express";
import { db } from "../db";
import { ah, HttpError, intParam } from "../lib/http";
import { audit } from "../lib/log";
import { hasRole, requireUser } from "../lib/auth";
import { ipKey, rateLimit } from "../lib/rateLimit";
import { normalizeEmail } from "../lib/normalize";
import { CAMPAIGN_STATUSES, ENROLLMENT_STATUSES, type EmailSystemStatus, type SuppressionReason } from "../../shared/email";
import { emailConfig, liveProblems, senderDisplayName } from "../email/config";
import { getEmailProvider } from "../email/provider";
import { escapeHtml, findPlaceholders, renderEmail } from "../email/template";
import * as svc from "../email/service";
import { schedulerRunning, sendTestEmail, testRecipientStatus } from "../email/scheduler";
import { processInbound, processProviderEvents, unsubscribeByToken } from "../email/webhooks";
import { draftingEnabled, generateDraft } from "../email/draft";

export const emailRouter = Router();

const HOUR = 3600 * 1000;

/* ================================================================== public endpoints (no X-User-Id) */

const webhookLimit = rateLimit({ name: "email-webhook", max: 600, windowMs: 60000, key: ipKey });

/** Brevo transactional events (delivered, bounces, unsubscribes …). Authenticated with BREVO_WEBHOOK_TOKEN. */
emailRouter.post(
  "/webhooks/brevo",
  webhookLimit,
  ah(async (req, res) => {
    const provider = getEmailProvider();
    if (!provider.verifyWebhook(req)) throw new HttpError(401, "Invalid webhook credentials");
    const events = provider.parseEvents(req.body);
    res.json(await processProviderEvents(db(), events, provider));
  }),
);

/** Brevo inbound parsing (replies sent to reply-<token>@EMAIL_REPLY_DOMAIN). */
emailRouter.post(
  "/webhooks/brevo/inbound",
  webhookLimit,
  ah(async (req, res) => {
    const provider = getEmailProvider();
    if (!provider.verifyWebhook(req)) throw new HttpError(401, "Invalid webhook credentials");
    const results = await processInbound(db(), provider.parseInbound(req.body), provider);
    res.json({ received: results.length, matched: results.filter((r) => r.matched).length, stopped: results.filter((r) => r.stopped).length });
  }),
);

const unsubLimit = rateLimit({ name: "email-unsubscribe", max: 30, windowMs: 60000, key: ipKey });
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;background:#f6f7f9;color:#111827;margin:0;padding:48px 16px}main{max-width:460px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;color:#4b5563}button{background:#0b63ce;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:15px;cursor:pointer}</style></head>
<body><main>${body}</main></body></html>`;

/** GET shows a confirmation (link scanners prefetch GETs, so it must not unsubscribe by itself). */
emailRouter.get("/unsubscribe/:token", unsubLimit, (req, res) => {
  const c = emailConfig();
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");
  res.send(
    page(
      "Unsubscribe",
      `<h1>Stop these emails?</h1><p>You will no longer receive outreach emails from ${escapeHtml([c.senderName, c.senderCompany].filter(Boolean).join(", ") || "us")}.</p>
<form method="post"><button type="submit">Unsubscribe</button></form>`,
    ),
  );
});

/** POST unsubscribes (form button, or RFC 8058 one-click from the List-Unsubscribe-Post header). */
emailRouter.post(
  "/unsubscribe/:token",
  unsubLimit,
  ah(async (req, res) => {
    const r = await unsubscribeByToken(db(), String(req.params.token), emailConfig().mode === "live" ? getEmailProvider() : null);
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    if (!r) return res.status(404).send(page("Link not recognised", `<h1>Link not recognised</h1><p>This unsubscribe link is invalid or has expired. Reply to the email and ask us to stop, and we will remove you.</p>`));
    res.send(page("Unsubscribed", `<h1>You have been unsubscribed</h1><p>${escapeHtml(r.email)} will not receive further outreach emails from us.</p>`));
  }),
);

/* ================================================================== authenticated endpoints */

emailRouter.use(requireUser);

const actor = (req: Request) => req.user!;
function requireApprover(req: Request) {
  if (!hasRole(req.user, emailConfig().approverRoles)) {
    throw new HttpError(403, `Only team members with role ${emailConfig().approverRoles.join(" or ")} can do this (EMAIL_APPROVER_ROLES)`);
  }
}
function paging(req: Request, def = 50, max = 200) {
  const limit = Math.min(Math.max(Number(req.query.limit) || def, 1), max);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  return { limit, offset };
}
const enumParam = <T extends string>(v: unknown, allowed: readonly T[], name: string): T | null => {
  if (v == null || v === "") return null;
  if (!allowed.includes(v as T)) throw new HttpError(400, `Invalid ${name}`);
  return v as T;
};

const sensitiveLimit = rateLimit({ name: "email-sensitive", max: 30, windowMs: HOUR });
// Rejected requests (bad/unauthorized recipient, request already in flight) do not use up the allowance.
const testLimit = rateLimit({ name: "email-test", max: 10, windowMs: HOUR, skipClientErrors: true });
const aiLimit = rateLimit({ name: "email-ai", max: 40, windowMs: HOUR });

emailRouter.get(
  "/status",
  ah(async (req, res) => {
    const c = emailConfig();
    const status: EmailSystemStatus = {
      mode: c.mode,
      provider: c.mode === "dry_run" ? "dry_run" : c.provider,
      scheduler_enabled: c.schedulerEnabled,
      scheduler_running: schedulerRunning(),
      reply_detection: Boolean(c.replyDomain && c.webhookToken),
      webhook_auth_configured: Boolean(c.webhookToken),
      live_ready: liveProblems(c).length === 0,
      live_problems: liveProblems(c),
      sender: { name: senderDisplayName(c), email: c.senderEmail, company: c.senderCompany, name_is_default: !c.senderName },
      test_recipients: c.testRecipients,
      recipient_allowlist: c.recipientAllowlist,
      limits: { daily_send_limit: c.dailySendLimit, max_recipients_per_campaign: c.maxRecipientsPerCampaign, batch_size: c.batchSize, max_attempts: c.maxAttempts },
      sent_today: await svc.sentToday(db(), c.mode),
      can_approve: hasRole(req.user, c.approverRoles),
      approver_roles: c.approverRoles,
      ai_enabled: draftingEnabled(),
    };
    res.json(status);
  }),
);

/* ---------- campaigns */

emailRouter.get(
  "/campaigns",
  ah(async (req, res) => {
    res.json(await svc.listCampaigns(db(), { status: enumParam(req.query.status, CAMPAIGN_STATUSES, "status"), ...paging(req) }));
  }),
);

emailRouter.post(
  "/campaigns",
  ah(async (req, res) => {
    res.status(201).json(await db().tx((q) => svc.createCampaign(q, req.body ?? {}, actor(req).id)));
  }),
);

emailRouter.get(
  "/campaigns/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const q = db();
    const campaign = await svc.getCampaign(q, id);
    const live = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND status IN ('pending', 'active', 'paused')`, [id])).rows[0].n;
    res.json({ campaign, steps: await svc.listSteps(q, id), readiness: await svc.approvalIssues(q, id), live_recipients: live });
  }),
);

emailRouter.patch(
  "/campaigns/:id",
  ah(async (req, res) => {
    res.json(await db().tx((q) => svc.updateCampaign(q, intParam(req.params.id), req.body ?? {}, actor(req).id)));
  }),
);

emailRouter.post(
  "/campaigns/:id/duplicate",
  ah(async (req, res) => {
    res.status(201).json(await db().tx((q) => svc.duplicateCampaign(q, intParam(req.params.id), actor(req).id)));
  }),
);

emailRouter.post(
  "/campaigns/:id/approve",
  sensitiveLimit,
  ah(async (req, res) => {
    requireApprover(req);
    res.json(await db().tx((q) => svc.approveCampaign(q, intParam(req.params.id), actor(req).id)));
  }),
);

emailRouter.post(
  "/campaigns/:id/activate",
  sensitiveLimit,
  ah(async (req, res) => {
    requireApprover(req);
    res.json(await db().tx((q) => svc.activateCampaign(q, intParam(req.params.id), actor(req).id, req.body ?? {})));
  }),
);

// Stopping is always allowed for any team member; restarting needs an approver.
emailRouter.post(
  "/campaigns/:id/pause",
  ah(async (req, res) => {
    res.json(await db().tx((q) => svc.pauseCampaign(q, intParam(req.params.id), actor(req).id)));
  }),
);
emailRouter.post(
  "/campaigns/:id/resume",
  sensitiveLimit,
  ah(async (req, res) => {
    requireApprover(req);
    res.json(await db().tx((q) => svc.resumeCampaign(q, intParam(req.params.id), actor(req).id)));
  }),
);
emailRouter.post(
  "/campaigns/:id/cancel",
  ah(async (req, res) => {
    if (req.body?.confirm !== true) throw new HttpError(400, "Cancelling stops every recipient permanently. Send { confirm: true } to proceed.");
    res.json(await db().tx((q) => svc.cancelCampaign(q, intParam(req.params.id), actor(req).id)));
  }),
);

/* ---------- steps */

emailRouter.post(
  "/campaigns/:id/steps",
  ah(async (req, res) => {
    res.status(201).json(await db().tx((q) => svc.addStep(q, intParam(req.params.id), req.body ?? {}, actor(req).id)));
  }),
);
emailRouter.post(
  "/campaigns/:id/steps/reorder",
  ah(async (req, res) => {
    res.json(await db().tx((q) => svc.reorderSteps(q, intParam(req.params.id), req.body?.step_ids, actor(req).id)));
  }),
);
emailRouter.patch(
  "/campaigns/:id/steps/:stepId",
  ah(async (req, res) => {
    res.json(await db().tx((q) => svc.updateStep(q, intParam(req.params.id), intParam(req.params.stepId, "stepId"), req.body ?? {}, actor(req).id)));
  }),
);
emailRouter.delete(
  "/campaigns/:id/steps/:stepId",
  ah(async (req, res) => {
    await db().tx((q) => svc.deleteStep(q, intParam(req.params.id), intParam(req.params.stepId, "stepId"), actor(req).id));
    res.json({ ok: true });
  }),
);

/** Render a step (or unsaved content) for a recipient. HTML is shown by the client in a sandboxed iframe. */
emailRouter.post(
  "/campaigns/:id/preview",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const q = db();
    const b = req.body ?? {};
    let content: { subject: string; text: string; html?: string | null };
    let enrollment: Awaited<ReturnType<typeof svc.getEnrollment>> | null = null;
    if (b.enrollment_id) {
      enrollment = await svc.getEnrollment(q, intParam(b.enrollment_id, "enrollment_id"));
      if (enrollment.campaign_id !== id) throw new HttpError(404, "Enrollment not found");
    }
    if (b.step_id) {
      const step = (await svc.listSteps(q, id)).find((s) => s.id === Number(b.step_id));
      if (!step) throw new HttpError(404, "Step not found");
      content = await svc.contentFor(q, enrollment?.id ?? null, step);
    } else {
      if (typeof b.subject !== "string" || typeof b.text !== "string") throw new HttpError(400, "Provide step_id, or subject and text");
      content = { subject: b.subject.slice(0, 300), text: b.text.slice(0, 20000), html: typeof b.html === "string" ? b.html.slice(0, 100000) : null };
    }
    const contactId = enrollment?.contact_id ?? (b.contact_id ? intParam(b.contact_id, "contact_id") : null);
    const vars = await svc.recipientVars(q, contactId, { name: enrollment?.recipient_name });
    res.json(renderEmail(content, vars, svc.footerInfo("preview-token")));
  }),
);

emailRouter.post(
  "/campaigns/:id/ai-draft",
  aiLimit,
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const q = db();
    const c = await svc.getCampaign(q, id);
    const steps = await svc.listSteps(q, id);
    const b = req.body ?? {};
    const stepOrder = b.step_order ? intParam(b.step_order, "step_order") : steps.length + 1;
    const cfg = emailConfig();
    const draft = await generateDraft(q, {
      campaign: { name: c.name, description: c.description },
      steps,
      stepOrder,
      contactId: b.contact_id ? intParam(b.contact_id, "contact_id") : null,
      purpose: typeof b.purpose === "string" ? b.purpose : null,
      sender: { name: senderDisplayName(cfg), company: cfg.senderCompany },
    });
    await audit(q, actor(req).id, "email_campaign", id, "ai_draft", { step_order: stepOrder, contact_id: b.contact_id ?? null });
    res.json(draft);
  }),
);

/* ---------- recipients */

emailRouter.get(
  "/campaigns/:id/eligible-contacts",
  ah(async (req, res) => {
    const { search, only_eligible, crm_status, include_ids } = req.query as Record<string, string | undefined>;
    const eligibility = only_eligible === "true" ? "eligible" : enumParam(req.query.eligibility, ["eligible", "ineligible"] as const, "eligibility");
    res.json(
      await svc.eligibleContacts(db(), intParam(req.params.id), {
        search: search?.trim().slice(0, 100) || null,
        eligibility,
        crmStatus: crm_status || null,
        includeIds: include_ids === "true",
        ...paging(req, 50, 500),
      }),
    );
  }),
);

emailRouter.get(
  "/campaigns/:id/enrollments",
  ah(async (req, res) => {
    res.json(await svc.listEnrollments(db(), intParam(req.params.id), { status: enumParam(req.query.status, ENROLLMENT_STATUSES, "status"), ...paging(req) }));
  }),
);

emailRouter.post(
  "/campaigns/:id/enrollments",
  ah(async (req, res) => {
    res.status(201).json(await db().tx((q) => svc.enrollContacts(q, intParam(req.params.id), req.body?.contact_ids, actor(req).id)));
  }),
);

emailRouter.get(
  "/enrollments/:id",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const q = db();
    const enrollment = await svc.getEnrollment(q, id);
    const events = (await q.query(`SELECT ev.*, s.step_order FROM email_send_events ev LEFT JOIN email_sequence_steps s ON s.id = ev.step_id WHERE ev.enrollment_id = $1 ORDER BY ev.occurred_at DESC, ev.id DESC LIMIT 200`, [id])).rows;
    const messages = (await q.query(`SELECT m.id, m.step_id, s.step_order, m.status, m.send_mode, m.attempts, m.subject, m.last_error, m.sent_at, m.delivered_at, m.created_at FROM email_messages m JOIN email_sequence_steps s ON s.id = m.step_id WHERE m.enrollment_id = $1 ORDER BY s.step_order`, [id])).rows;
    const drafts = (await q.query(`SELECT d.*, s.step_order FROM email_personalized_drafts d JOIN email_sequence_steps s ON s.id = d.step_id WHERE d.enrollment_id = $1 ORDER BY s.step_order`, [id])).rows;
    res.json({ enrollment, events, messages, drafts });
  }),
);

emailRouter.post(
  "/enrollments/:id/pause",
  ah(async (req, res) => {
    res.json(await db().tx((q) => svc.pauseEnrollment(q, intParam(req.params.id), actor(req).id)));
  }),
);
emailRouter.post(
  "/enrollments/:id/resume",
  ah(async (req, res) => {
    const resolution = req.body?.ambiguous_resolution;
    if (resolution) requireApprover(req); // deciding whether an email was sent is an approver call
    res.json(await db().tx((q) => svc.resumeEnrollment(q, intParam(req.params.id), actor(req).id, { ambiguous_resolution: resolution })));
  }),
);
emailRouter.post(
  "/enrollments/:id/remove",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    await db().tx(async (q) => {
      await svc.getEnrollment(q, id);
      if (!(await svc.stopEnrollment(q, id, "cancelled", `Removed by ${actor(req).name}`))) throw new HttpError(409, "This recipient's sequence has already stopped");
      await audit(q, actor(req).id, "email_enrollment", id, "remove");
    });
    res.json(await svc.getEnrollment(db(), id));
  }),
);
/** Manual reply signal, for replies that reached a mailbox WSIS cannot read. */
emailRouter.post(
  "/enrollments/:id/mark-replied",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    await db().tx(async (q) => {
      const e = await svc.getEnrollment(q, id);
      if (!(await svc.stopEnrollment(q, id, "replied", `Reply recorded manually by ${actor(req).name}`))) throw new HttpError(409, "This recipient's sequence has already stopped");
      await q.query(`INSERT INTO email_send_events (campaign_id, enrollment_id, event_type, email, metadata) VALUES ($1, $2, 'reply', $3, $4)`, [e.campaign_id, id, e.email, JSON.stringify({ match_method: "manual", by: actor(req).name })]);
      await audit(q, actor(req).id, "email_enrollment", id, "mark_replied");
    });
    res.json(await svc.getEnrollment(db(), id));
  }),
);

/* ---------- personalized drafts */

emailRouter.put(
  "/enrollments/:id/drafts/:stepId",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const stepId = intParam(req.params.stepId, "stepId");
    const b = req.body ?? {};
    if (typeof b.subject !== "string" || !b.subject.trim() || typeof b.text_body !== "string" || !b.text_body.trim()) throw new HttpError(400, "subject and text_body are required");
    const row = await db().tx(async (q) => {
      const e = await svc.getEnrollment(q, id);
      if (!["pending", "active", "paused"].includes(e.status)) throw new HttpError(409, `This recipient's sequence is ${e.status}`);
      const step = (await svc.listSteps(q, e.campaign_id)).find((s) => s.id === stepId);
      if (!step) throw new HttpError(404, "Step not found");
      if (step.step_order <= e.current_step) throw new HttpError(409, "This step has already been sent to this recipient");
      const { rows } = await q.query(
        `INSERT INTO email_personalized_drafts (enrollment_id, step_id, subject, text_body, source, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (enrollment_id, step_id) DO UPDATE SET subject = EXCLUDED.subject, text_body = EXCLUDED.text_body, source = EXCLUDED.source, notes = EXCLUDED.notes,
           status = 'pending_review', reviewed_by = NULL, reviewed_at = NULL, created_by = EXCLUDED.created_by, updated_at = now()
         RETURNING *`,
        [id, stepId, b.subject.trim().slice(0, 300), b.text_body.trim().slice(0, 20000), b.source === "ai" ? "ai" : "manual", JSON.stringify(b.notes ?? {}), actor(req).id],
      );
      await audit(q, actor(req).id, "email_draft", rows[0].id, "save", { enrollment_id: id, step_id: stepId, source: b.source });
      return rows[0];
    });
    res.json(row);
  }),
);

emailRouter.post(
  "/enrollments/:id/drafts/:stepId/:decision",
  ah(async (req, res) => {
    requireApprover(req);
    const id = intParam(req.params.id);
    const stepId = intParam(req.params.stepId, "stepId");
    const decision = req.params.decision;
    if (decision !== "approve" && decision !== "reject") throw new HttpError(400, "Decision must be approve or reject");
    const out = await db().tx(async (q) => {
      const { rows } = await q.query(`SELECT * FROM email_personalized_drafts WHERE enrollment_id = $1 AND step_id = $2`, [id, stepId]);
      if (!rows[0]) throw new HttpError(404, "Draft not found");
      if (decision === "approve") {
        const ph = findPlaceholders(rows[0].subject, rows[0].text_body);
        if (ph.length) throw new HttpError(422, `Fill in the placeholders first: ${ph.map((p) => `[[${p}]]`).join(", ")}`);
      }
      await q.query(`UPDATE email_personalized_drafts SET status = $3, reviewed_by = $4, reviewed_at = now(), updated_at = now() WHERE enrollment_id = $1 AND step_id = $2`, [
        id,
        stepId,
        decision === "approve" ? "approved" : "rejected",
        actor(req).id,
      ]);
      // Release an enrollment the worker held back because this draft was awaiting review.
      await q.query(`UPDATE email_sequence_enrollments SET status = 'active', stop_reason = NULL, last_error = NULL, updated_at = now() WHERE id = $1 AND status = 'paused' AND stop_reason = 'draft_pending'`, [id]);
      await audit(q, actor(req).id, "email_draft", rows[0].id, decision);
      return svc.getEnrollment(q, id);
    });
    res.json(out);
  }),
);

/* ---------- test email, events, analytics */

/** Is this address allowed to receive test emails? Lets the UI explain before anything is sent. */
emailRouter.get(
  "/test-recipient",
  ah(async (req, res) => {
    res.json(await testRecipientStatus(db(), String(req.query.to ?? "").slice(0, 320)));
  }),
);

emailRouter.post(
  "/campaigns/:id/test-email",
  testLimit,
  ah(async (req, res) => {
    requireApprover(req);
    const b = req.body ?? {};
    const r = await sendTestEmail(db(), {
      campaignId: intParam(req.params.id),
      stepId: intParam(b.step_id, "step_id"),
      to: String(b.to ?? ""),
      contactId: b.contact_id ? intParam(b.contact_id, "contact_id") : null,
      actor: actor(req),
    });
    if (r.result.status !== "accepted") throw new HttpError(502, `Test email was not sent: ${r.result.error}`);
    res.json({ ok: true, mode: r.mode, to: r.to, missing: r.missing, placeholders: r.placeholders });
  }),
);

emailRouter.get(
  "/campaigns/:id/events",
  ah(async (req, res) => {
    const id = intParam(req.params.id);
    const { limit, offset } = paging(req, 100, 500);
    const q = db();
    const { rows } = await q.query(
      `SELECT ev.id, ev.campaign_id, ev.enrollment_id, ev.step_id, s.step_order, ev.message_id, ev.event_type, ev.attempt_number, ev.provider, ev.provider_message_id, ev.email, ev.metadata, ev.occurred_at
         FROM email_send_events ev LEFT JOIN email_sequence_steps s ON s.id = ev.step_id
        WHERE ev.campaign_id = $1 ORDER BY ev.occurred_at DESC, ev.id DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM email_send_events WHERE campaign_id = $1`, [id])).rows[0].n;
    res.json({ items: rows, total, limit, offset });
  }),
);

emailRouter.get(
  "/campaigns/:id/analytics",
  ah(async (req, res) => {
    res.json(await svc.campaignAnalytics(db(), intParam(req.params.id)));
  }),
);

/* ---------- suppressions */

emailRouter.get(
  "/suppressions",
  ah(async (req, res) => {
    const { limit, offset } = paging(req);
    const search = typeof req.query.q === "string" && req.query.q ? `%${req.query.q.toLowerCase().slice(0, 100)}%` : null;
    const { rows } = await db().query(`SELECT id, email, reason, source, created_at FROM email_suppressions WHERE ($1::text IS NULL OR email LIKE $1) ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [search, limit, offset]);
    const total = (await db().query<{ n: number }>(`SELECT count(*)::int n FROM email_suppressions WHERE ($1::text IS NULL OR email LIKE $1)`, [search])).rows[0].n;
    res.json({ items: rows, total, limit, offset });
  }),
);

emailRouter.post(
  "/suppressions",
  ah(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) throw new HttpError(400, "A valid email address is required");
    const reason: SuppressionReason = req.body?.reason === "unsubscribed" ? "unsubscribed" : "manual";
    const r = await db().tx(async (q) => {
      const out = await svc.suppressEmail(q, email, reason, `manual:${actor(req).name}`, { actorId: actor(req).id, details: { note: String(req.body?.note ?? "").slice(0, 500) } });
      await audit(q, actor(req).id, "email_suppression", null, "add", { email, reason });
      return out;
    });
    if (r.added && emailConfig().mode === "live") await getEmailProvider().suppress?.(email).catch((e) => console.error("[email] suppression sync failed:", (e as Error).message));
    res.status(201).json(r);
  }),
);

/** Only manual suppressions can be lifted; unsubscribes, bounces and complaints are permanent. */
emailRouter.delete(
  "/suppressions/:id",
  ah(async (req, res) => {
    requireApprover(req);
    const id = intParam(req.params.id);
    const { rows } = await db().query<{ email: string; reason: string }>(`SELECT email, reason FROM email_suppressions WHERE id = $1`, [id]);
    if (!rows[0]) throw new HttpError(404, "Suppression not found");
    if (rows[0].reason !== "manual") throw new HttpError(409, `A ${rows[0].reason.replace("_", " ")} suppression cannot be lifted`);
    await db().query(`DELETE FROM email_suppressions WHERE id = $1`, [id]);
    await audit(db(), actor(req).id, "email_suppression", id, "remove", rows[0]);
    res.json({ ok: true });
  }),
);
