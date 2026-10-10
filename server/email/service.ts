import crypto from "node:crypto";
import type { Queryable } from "../db";
import { HttpError } from "../lib/http";
import { audit, logActivity } from "../lib/log";
import { PRIMARY_OPPORTUNITY_ORDER } from "../lib/crm";
import { normalizeEmail } from "../lib/normalize";
import { CLOSED_STATUSES } from "../../shared/constants";
import type {
  CampaignAnalytics,
  CampaignSettings,
  EligibleContact,
  EligibleContactsPage,
  EmailCampaign,
  Enrollment,
  EnrollmentStatus,
  Page,
  SendWindow,
  SequenceStep,
  SuppressionReason,
} from "../../shared/email";
import { emailConfig, liveProblems, recipientAllowed, senderDisplayName } from "./config";
import { findPlaceholders, firstName, renderEmail, unknownVariables, type FooterInfo, type TemplateVars } from "./template";

/* ------------------------------------------------------------------ settings & time */

export const DEFAULT_SETTINGS: Required<CampaignSettings> = {
  send_window: { start_hour: 9, end_hour: 18, weekdays_only: true },
  stop_on_crm_statuses: [...CLOSED_STATUSES],
};

export function campaignSettings(s: CampaignSettings | null | undefined): Required<CampaignSettings> {
  return {
    send_window: s && "send_window" in s ? s.send_window ?? null : DEFAULT_SETTINGS.send_window,
    stop_on_crm_statuses: Array.isArray(s?.stop_on_crm_statuses) ? s!.stop_on_crm_statuses : DEFAULT_SETTINGS.stop_on_crm_statuses,
  };
}

export function validateSettings(s: unknown): CampaignSettings {
  if (s == null) return {};
  if (typeof s !== "object") throw new HttpError(400, "settings must be an object");
  const out: CampaignSettings = {};
  const v = s as Record<string, unknown>;
  if ("send_window" in v) {
    if (v.send_window === null) out.send_window = null;
    else {
      const w = v.send_window as Record<string, unknown>;
      const start = Number(w?.start_hour);
      const end = Number(w?.end_hour);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) {
        throw new HttpError(400, "Send window needs whole hours with 0 ≤ start < end ≤ 24 (India Standard Time)");
      }
      out.send_window = { start_hour: start, end_hour: end, weekdays_only: Boolean(w.weekdays_only) };
    }
  }
  if ("stop_on_crm_statuses" in v) {
    if (!Array.isArray(v.stop_on_crm_statuses) || v.stop_on_crm_statuses.some((x) => typeof x !== "string")) throw new HttpError(400, "stop_on_crm_statuses must be a list of CRM statuses");
    out.stop_on_crm_statuses = v.stop_on_crm_statuses as string[];
  }
  return out;
}

const IST_OFFSET_MS = 330 * 60 * 1000; // Asia/Kolkata has no DST

/** Move `t` forward to the next moment inside the send window (interpreted in IST). */
export function alignToWindow(t: Date, w: SendWindow | null): Date {
  if (!w) return t;
  let ist = new Date(t.getTime() + IST_OFFSET_MS);
  for (let i = 0; i < 10; i++) {
    const day = ist.getUTCDay();
    const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const startOfDay = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
    if (w.weekdays_only && (day === 0 || day === 6)) {
      ist = new Date(startOfDay + 86400000 + w.start_hour * 3600000);
      continue;
    }
    if (minutes < w.start_hour * 60) {
      ist = new Date(startOfDay + w.start_hour * 3600000);
      continue;
    }
    if (minutes >= w.end_hour * 60) {
      ist = new Date(startOfDay + 86400000 + w.start_hour * 3600000);
      continue;
    }
    break;
  }
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

export function scheduleAfter(base: Date, delayMinutes: number, w: SendWindow | null): Date {
  return alignToWindow(new Date(base.getTime() + delayMinutes * 60000), w);
}

const token = (bytes: number, enc: "hex" | "base64url") => crypto.randomBytes(bytes).toString(enc);

/* ------------------------------------------------------------------ campaigns */

const CAMPAIGN_SELECT = `
  SELECT c.*, cu.name AS created_by_name, au.name AS approved_by_name,
    (SELECT count(*)::int FROM email_sequence_enrollments e WHERE e.campaign_id = c.id AND e.status <> 'cancelled') AS audience,
    (SELECT count(*)::int FROM email_sequence_steps s WHERE s.campaign_id = c.id AND s.active) AS steps,
    (SELECT count(*)::int FROM email_messages m WHERE m.campaign_id = c.id AND m.status = 'sent') AS sent,
    (SELECT count(*)::int FROM email_sequence_enrollments e WHERE e.campaign_id = c.id AND e.status = 'replied') AS replied,
    (SELECT count(DISTINCT t.id)::int FROM tasks t JOIN email_sequence_enrollments e ON e.organization_id = t.organization_id AND e.campaign_id = c.id
       WHERE t.task_type = 'Meeting' AND t.status <> 'Cancelled' AND t.created_at >= e.enrolled_at) AS meetings
  FROM email_campaigns c
  LEFT JOIN users cu ON cu.id = c.created_by
  LEFT JOIN users au ON au.id = c.approved_by`;

export async function getCampaign(q: Queryable, id: number): Promise<EmailCampaign> {
  const { rows } = await q.query<EmailCampaign>(`${CAMPAIGN_SELECT} WHERE c.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Campaign not found");
  return rows[0];
}

export async function listCampaigns(q: Queryable, opts: { status?: string | null; limit: number; offset: number }): Promise<Page<EmailCampaign>> {
  const { rows } = await q.query<EmailCampaign>(`${CAMPAIGN_SELECT} WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.updated_at DESC, c.id DESC LIMIT $2 OFFSET $3`, [opts.status ?? null, opts.limit, opts.offset]);
  const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM email_campaigns WHERE ($1::text IS NULL OR status = $1)`, [opts.status ?? null])).rows[0].n;
  return { items: rows, total, limit: opts.limit, offset: opts.offset };
}

export function validateCampaignInput(b: Record<string, unknown>, partial: boolean) {
  const out: { name?: string; description?: string | null; settings?: CampaignSettings } = {};
  if ("name" in b || !partial) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) throw new HttpError(400, "Campaign name is required");
    if (name.length > 200) throw new HttpError(400, "Campaign name is too long (max 200 characters)");
    out.name = name;
  }
  if ("description" in b) {
    if (b.description != null && typeof b.description !== "string") throw new HttpError(400, "description must be text");
    out.description = (b.description as string | null)?.trim().slice(0, 4000) || null;
  }
  if ("settings" in b) out.settings = validateSettings(b.settings);
  return out;
}

export async function createCampaign(q: Queryable, b: Record<string, unknown>, actor: number) {
  const v = validateCampaignInput(b, false);
  const { rows } = await q.query<{ id: number }>(
    `INSERT INTO email_campaigns (name, description, settings, created_by) VALUES ($1, $2, $3, $4) RETURNING id`,
    [v.name, v.description ?? null, JSON.stringify({ ...DEFAULT_SETTINGS, ...(v.settings ?? {}) }), actor],
  );
  await audit(q, actor, "email_campaign", rows[0].id, "create", v);
  return getCampaign(q, rows[0].id);
}

export async function updateCampaign(q: Queryable, id: number, b: Record<string, unknown>, actor: number) {
  const cur = await getCampaign(q, id);
  if (cur.status === "cancelled" || cur.status === "completed") throw new HttpError(409, `A ${cur.status} campaign cannot be edited`);
  const v = validateCampaignInput(b, true);
  const settings = v.settings ? { ...cur.settings, ...v.settings } : cur.settings;
  await q.query(`UPDATE email_campaigns SET name = coalesce($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END, settings = $5, updated_at = now() WHERE id = $1`, [
    id,
    v.name ?? null,
    "description" in v,
    v.description ?? null,
    JSON.stringify(settings),
  ]);
  await audit(q, actor, "email_campaign", id, "update", v);
  return getCampaign(q, id);
}

/** Content changes are only allowed while nothing is sending; they invalidate the approval. */
async function assertContentEditable(q: Queryable, campaignId: number) {
  const c = await getCampaign(q, campaignId);
  if (!["draft", "paused"].includes(c.status)) throw new HttpError(409, `Sequence steps can only be changed while the campaign is draft or paused (it is ${c.status}). Pause it first.`);
  return c;
}
async function bumpContent(q: Queryable, campaignId: number) {
  await q.query(`UPDATE email_campaigns SET content_version = content_version + 1, approved_version = NULL, approved_by = NULL, approved_at = NULL, updated_at = now() WHERE id = $1`, [campaignId]);
}

export async function duplicateCampaign(q: Queryable, id: number, actor: number) {
  const c = await getCampaign(q, id);
  const { rows } = await q.query<{ id: number }>(`INSERT INTO email_campaigns (name, description, settings, created_by) VALUES ($1, $2, $3, $4) RETURNING id`, [
    `${c.name} (copy)`.slice(0, 200),
    c.description,
    JSON.stringify(c.settings),
    actor,
  ]);
  await q.query(
    `INSERT INTO email_sequence_steps (campaign_id, step_order, subject_template, text_template, html_template, delay_minutes, active)
     SELECT $2, step_order, subject_template, text_template, html_template, delay_minutes, active FROM email_sequence_steps WHERE campaign_id = $1`,
    [id, rows[0].id],
  );
  await audit(q, actor, "email_campaign", rows[0].id, "duplicate", { from: id });
  return getCampaign(q, rows[0].id);
}

/* ------------------------------------------------------------------ steps */

export async function listSteps(q: Queryable, campaignId: number): Promise<SequenceStep[]> {
  return (await q.query<SequenceStep>(`SELECT * FROM email_sequence_steps WHERE campaign_id = $1 ORDER BY step_order`, [campaignId])).rows;
}

function validateStepInput(b: Record<string, unknown>, partial: boolean) {
  const out: Partial<Pick<SequenceStep, "subject_template" | "text_template" | "html_template" | "delay_minutes" | "active">> = {};
  const text = (k: string, max: number, required: boolean) => {
    if (!(k in b)) {
      if (required && !partial) throw new HttpError(400, `${k} is required`);
      return undefined;
    }
    const v = b[k];
    if (v != null && typeof v !== "string") throw new HttpError(400, `${k} must be text`);
    const s = (v as string | null)?.trim() ?? "";
    if (required && !s) throw new HttpError(400, `${k === "subject_template" ? "Subject" : "Email body"} cannot be empty`);
    if (s.length > max) throw new HttpError(400, `${k} is too long (max ${max} characters)`);
    return s;
  };
  const subject = text("subject_template", 300, true);
  if (subject !== undefined) out.subject_template = subject;
  const body = text("text_template", 20000, true);
  if (body !== undefined) out.text_template = body;
  const html = text("html_template", 100000, false);
  if (html !== undefined) out.html_template = html || null;
  if ("delay_minutes" in b || !partial) {
    const d = b.delay_minutes === undefined ? 0 : Number(b.delay_minutes);
    if (!Number.isInteger(d) || d < 0 || d > 60 * 24 * 365) throw new HttpError(400, "delay_minutes must be a whole number between 0 and 525600");
    out.delay_minutes = d;
  }
  if ("active" in b) out.active = Boolean(b.active);
  const unknown = unknownVariables([out.subject_template, out.text_template, out.html_template].filter(Boolean).join("\n"));
  if (unknown.length) throw new HttpError(400, `Unknown personalization variable(s): ${unknown.map((u) => `{{${u}}}`).join(", ")}`);
  return out;
}

export async function addStep(q: Queryable, campaignId: number, b: Record<string, unknown>, actor: number) {
  await assertContentEditable(q, campaignId);
  const v = validateStepInput(b, false);
  const { rows: mx } = await q.query<{ n: number }>(`SELECT coalesce(max(step_order), 0)::int n FROM email_sequence_steps WHERE campaign_id = $1`, [campaignId]);
  const { rows } = await q.query<SequenceStep>(
    `INSERT INTO email_sequence_steps (campaign_id, step_order, subject_template, text_template, html_template, delay_minutes, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [campaignId, mx[0].n + 1, v.subject_template, v.text_template, v.html_template ?? null, v.delay_minutes ?? 0, v.active ?? true],
  );
  await bumpContent(q, campaignId);
  await audit(q, actor, "email_step", rows[0].id, "create", v);
  return rows[0];
}

export async function updateStep(q: Queryable, campaignId: number, stepId: number, b: Record<string, unknown>, actor: number) {
  await assertContentEditable(q, campaignId);
  const v = validateStepInput(b, true);
  const { rows } = await q.query<SequenceStep>(
    `UPDATE email_sequence_steps SET
       subject_template = coalesce($3, subject_template), text_template = coalesce($4, text_template),
       html_template = CASE WHEN $5::boolean THEN $6 ELSE html_template END,
       delay_minutes = coalesce($7, delay_minutes), active = coalesce($8, active), updated_at = now()
     WHERE id = $1 AND campaign_id = $2 RETURNING *`,
    [stepId, campaignId, v.subject_template ?? null, v.text_template ?? null, "html_template" in v, v.html_template ?? null, v.delay_minutes ?? null, v.active ?? null],
  );
  if (!rows[0]) throw new HttpError(404, "Step not found");
  await bumpContent(q, campaignId);
  await audit(q, actor, "email_step", stepId, "update", v);
  return rows[0];
}

export async function deleteStep(q: Queryable, campaignId: number, stepId: number, actor: number) {
  await assertContentEditable(q, campaignId);
  const { rows: used } = await q.query(`SELECT 1 FROM email_messages WHERE step_id = $1 LIMIT 1`, [stepId]);
  if (used[0]) throw new HttpError(409, "This step has already been sent to some recipients. Deactivate it instead of deleting it.");
  const { rows } = await q.query<{ step_order: number }>(`DELETE FROM email_sequence_steps WHERE id = $1 AND campaign_id = $2 RETURNING step_order`, [stepId, campaignId]);
  if (!rows[0]) throw new HttpError(404, "Step not found");
  await renumber(q, campaignId, (await listSteps(q, campaignId)).map((s) => s.id));
  await bumpContent(q, campaignId);
  await audit(q, actor, "email_step", stepId, "delete");
}

/** Two-phase renumber so the (campaign_id, step_order) unique constraint is never violated mid-update. */
async function renumber(q: Queryable, campaignId: number, ids: number[]) {
  await q.query(`UPDATE email_sequence_steps SET step_order = step_order + 1000000 WHERE campaign_id = $1`, [campaignId]);
  for (let i = 0; i < ids.length; i++) await q.query(`UPDATE email_sequence_steps SET step_order = $3, updated_at = now() WHERE id = $1 AND campaign_id = $2`, [ids[i], campaignId, i + 1]);
}

export async function reorderSteps(q: Queryable, campaignId: number, stepIds: unknown, actor: number) {
  await assertContentEditable(q, campaignId);
  const steps = await listSteps(q, campaignId);
  if (!Array.isArray(stepIds) || stepIds.length !== steps.length || new Set(stepIds).size !== steps.length || !stepIds.every((id) => steps.some((s) => s.id === id))) {
    throw new HttpError(400, "step_ids must list every step of this campaign exactly once");
  }
  const { rows: sent } = await q.query(`SELECT 1 FROM email_messages WHERE campaign_id = $1 LIMIT 1`, [campaignId]);
  if (sent[0]) throw new HttpError(409, "Steps cannot be reordered after the campaign has started sending");
  await renumber(q, campaignId, stepIds as number[]);
  await bumpContent(q, campaignId);
  await audit(q, actor, "email_campaign", campaignId, "reorder_steps", { step_ids: stepIds });
  return listSteps(q, campaignId);
}

/* ------------------------------------------------------------------ recipients & eligibility */

export async function suppressionFor(q: Queryable, email: string): Promise<{ reason: SuppressionReason } | null> {
  const { rows } = await q.query<{ reason: SuppressionReason }>(`SELECT reason FROM email_suppressions WHERE email = $1`, [email.toLowerCase()]);
  return rows[0] ?? null;
}

const CONTACT_SELECT = `
  SELECT c.id AS contact_id, c.name, c.designation, c.email, org.id AS organization_id, org.name AS organization_name,
         org.merged_into, o.id AS opportunity_id, o.status AS crm_status, o.stage_kind,
         sup.reason AS suppressed_reason,
         (SELECT e.status FROM email_sequence_enrollments e WHERE e.campaign_id = $1 AND (e.contact_id = c.id OR e.email = lower(c.email)) ORDER BY e.id DESC LIMIT 1) AS enrollment_status
    FROM contacts c
    JOIN organizations org ON org.id = c.organization_id
    -- An organization can have several opportunities (relationship + project pipelines): use its primary one.
    LEFT JOIN LATERAL (
      SELECT o.id, o.status, ps.kind AS stage_kind
        FROM crm_opportunities o
        LEFT JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
       WHERE o.organization_id = org.id
       ORDER BY ${PRIMARY_OPPORTUNITY_ORDER}
       LIMIT 1
    ) o ON TRUE
    LEFT JOIN email_suppressions sup ON sup.email = lower(c.email)`;

interface ContactRow {
  contact_id: number;
  name: string;
  designation: string | null;
  email: string | null;
  organization_id: number;
  organization_name: string;
  merged_into: number | null;
  opportunity_id: number | null;
  crm_status: string | null;
  stage_kind: "open" | "won" | "lost" | null;
  suppressed_reason: string | null;
  enrollment_status: EnrollmentStatus | null;
}

const SUPPRESSION_LABEL: Record<SuppressionReason, string> = {
  unsubscribed: "unsubscribed",
  hard_bounce: "email bounced (hard bounce)",
  complaint: "marked an email as spam",
  invalid: "address rejected as invalid",
  blocked: "blocked by the email provider",
  manual: "added to the suppression list manually",
};

function eligibility(r: ContactRow, settings: Required<CampaignSettings>): EligibleContact {
  const reasons: string[] = [];
  const email = normalizeEmail(r.email);
  if (!r.email) reasons.push("No email address");
  else if (!email || email !== r.email.trim().toLowerCase()) reasons.push("Email address looks invalid");
  if (r.merged_into) reasons.push("Organization was merged into another record");
  if (!r.opportunity_id) reasons.push("Organization is not in the CRM");
  // Closed (won/lost) stages in any pipeline stop outreach, plus any stage named in the campaign's stop list.
  if (r.crm_status && (settings.stop_on_crm_statuses.includes(r.crm_status) || (r.stage_kind && r.stage_kind !== "open"))) reasons.push(`CRM status is ${r.crm_status}`);
  if (r.suppressed_reason) reasons.push(`Suppressed: ${SUPPRESSION_LABEL[r.suppressed_reason as SuppressionReason] ?? r.suppressed_reason}`);
  if (r.enrollment_status && ["pending", "active", "paused"].includes(r.enrollment_status)) reasons.push("Already enrolled in this campaign");
  else if (r.enrollment_status && ["replied", "unsubscribed", "bounced", "completed"].includes(r.enrollment_status)) reasons.push(`Previously ${r.enrollment_status} in this campaign`);
  if (email && !recipientAllowed(email)) reasons.push("Outside EMAIL_RECIPIENT_ALLOWLIST (sending restriction)");
  return {
    contact_id: r.contact_id,
    name: r.name,
    designation: r.designation,
    email: r.email,
    organization_id: r.organization_id,
    organization_name: r.organization_name,
    opportunity_id: r.opportunity_id,
    crm_status: r.crm_status,
    eligible: reasons.length === 0,
    reasons,
  };
}

/** Most eligible contact ids returned for "select all eligible" (well above EMAIL_MAX_RECIPIENTS_PER_CAMPAIGN's default). */
export const MAX_ELIGIBLE_IDS = 1000;

/**
 * CRM prospects (contacts of organizations that have an opportunity) with their eligibility for this campaign.
 * Display only: enrollContacts re-checks every contact, and the worker re-checks again right before sending.
 */
export async function eligibleContacts(
  q: Queryable,
  campaignId: number,
  opts: { search?: string | null; eligibility?: "eligible" | "ineligible" | null; crmStatus?: string | null; includeIds?: boolean; limit: number; offset: number },
): Promise<EligibleContactsPage> {
  const c = await getCampaign(q, campaignId);
  const settings = campaignSettings(c.settings);
  const where = [`o.id IS NOT NULL`, `org.merged_into IS NULL`];
  const params: unknown[] = [campaignId];
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    where.push(`(lower(c.name) LIKE $${params.length} OR lower(org.name) LIKE $${params.length} OR lower(coalesce(c.email,'')) LIKE $${params.length})`);
  }
  if (opts.crmStatus) {
    params.push(opts.crmStatus);
    where.push(`o.status = $${params.length}`);
  }
  const { rows } = await q.query<ContactRow>(`${CONTACT_SELECT} WHERE ${where.join(" AND ")} ORDER BY org.name, c.is_primary DESC, c.name`, params);
  const all = rows.map((r) => eligibility(r, settings));
  const eligible = all.filter((x) => x.eligible);
  const items = opts.eligibility === "eligible" ? eligible : opts.eligibility === "ineligible" ? all.filter((x) => !x.eligible) : all;
  const { rows: crm } = await q.query<{ n: number }>(
    `SELECT count(*)::int n FROM contacts c JOIN organizations org ON org.id = c.organization_id JOIN crm_opportunities o ON o.organization_id = org.id WHERE org.merged_into IS NULL`,
  );
  return {
    items: items.slice(opts.offset, opts.offset + opts.limit),
    total: items.length,
    limit: opts.limit,
    offset: opts.offset,
    eligible_total: eligible.length,
    ineligible_total: all.length - eligible.length,
    crm_contacts: crm[0].n,
    ...(opts.includeIds ? { eligible_ids: eligible.slice(0, MAX_ELIGIBLE_IDS).map((x) => x.contact_id) } : {}),
  };
}

const ENROLLMENT_SELECT = `
  SELECT e.id, e.campaign_id, e.contact_id, e.organization_id, org.name AS organization_name, e.opportunity_id, e.email, e.recipient_name,
         e.current_step, e.status, e.next_send_at, e.attempt_count, e.last_error, e.stop_reason, e.enrolled_at, e.stopped_at, e.updated_at,
         (SELECT count(*)::int FROM email_personalized_drafts d WHERE d.enrollment_id = e.id AND d.status = 'pending_review') AS pending_drafts,
         EXISTS (SELECT 1 FROM email_messages m WHERE m.enrollment_id = e.id AND m.status IN ('ambiguous', 'sending')) AS ambiguous_message
    FROM email_sequence_enrollments e
    LEFT JOIN organizations org ON org.id = e.organization_id`;

export async function getEnrollment(q: Queryable, id: number): Promise<Enrollment> {
  const { rows } = await q.query<Enrollment>(`${ENROLLMENT_SELECT} WHERE e.id = $1`, [id]);
  if (!rows[0]) throw new HttpError(404, "Enrollment not found");
  return rows[0];
}

export async function listEnrollments(q: Queryable, campaignId: number, opts: { status?: string | null; limit: number; offset: number }): Promise<Page<Enrollment>> {
  const { rows } = await q.query<Enrollment>(`${ENROLLMENT_SELECT} WHERE e.campaign_id = $1 AND ($2::text IS NULL OR e.status = $2) ORDER BY e.id LIMIT $3 OFFSET $4`, [
    campaignId,
    opts.status ?? null,
    opts.limit,
    opts.offset,
  ]);
  const total = (await q.query<{ n: number }>(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND ($2::text IS NULL OR status = $2)`, [campaignId, opts.status ?? null])).rows[0].n;
  return { items: rows, total, limit: opts.limit, offset: opts.offset };
}

async function firstActiveStep(q: Queryable, campaignId: number, afterOrder = 0): Promise<SequenceStep | null> {
  const { rows } = await q.query<SequenceStep>(`SELECT * FROM email_sequence_steps WHERE campaign_id = $1 AND active AND step_order > $2 ORDER BY step_order LIMIT 1`, [campaignId, afterOrder]);
  return rows[0] ?? null;
}
export { firstActiveStep as nextActiveStep };

export async function enrollContacts(q: Queryable, campaignId: number, contactIds: unknown, actor: number, now = new Date()) {
  if (!Array.isArray(contactIds) || !contactIds.length || contactIds.some((x) => !Number.isInteger(x) || x <= 0)) throw new HttpError(400, "contact_ids must be a non-empty list of contact ids");
  if (contactIds.length > 500) throw new HttpError(400, "Enroll at most 500 contacts at a time");
  const c = await getCampaign(q, campaignId);
  if (["completed", "cancelled"].includes(c.status)) throw new HttpError(409, `Cannot add recipients to a ${c.status} campaign`);
  const settings = campaignSettings(c.settings);
  const cfg = emailConfig();
  const { rows: cnt } = await q.query<{ n: number }>(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND status <> 'cancelled'`, [campaignId]);
  let room = cfg.maxRecipientsPerCampaign - cnt[0].n;

  const live = c.status === "active" || c.status === "scheduled";
  const step1 = live ? await firstActiveStep(q, campaignId) : null;
  const startBase = c.status === "scheduled" && c.scheduled_start_at && new Date(c.scheduled_start_at) > now ? new Date(c.scheduled_start_at) : now;

  const enrolled: number[] = [];
  const skipped: { contact_id: number; reasons: string[] }[] = [];
  for (const contactId of [...new Set(contactIds as number[])]) {
    const { rows } = await q.query<ContactRow>(`${CONTACT_SELECT} WHERE c.id = $2`, [campaignId, contactId]);
    if (!rows[0]) {
      skipped.push({ contact_id: contactId, reasons: ["Contact not found"] });
      continue;
    }
    const el = eligibility(rows[0], settings);
    if (!el.eligible) {
      skipped.push({ contact_id: contactId, reasons: el.reasons });
      continue;
    }
    if (room <= 0) {
      skipped.push({ contact_id: contactId, reasons: [`Campaign limit of ${cfg.maxRecipientsPerCampaign} recipients reached (EMAIL_MAX_RECIPIENTS_PER_CAMPAIGN)`] });
      continue;
    }
    const email = normalizeEmail(rows[0].email)!;
    const ins = await q.query<{ id: number }>(
      `INSERT INTO email_sequence_enrollments (campaign_id, contact_id, organization_id, opportunity_id, email, recipient_name, status, next_send_at, unsubscribe_token, reply_token, enrolled_by, enrolled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        campaignId,
        contactId,
        rows[0].organization_id,
        rows[0].opportunity_id,
        email,
        rows[0].name,
        live ? "active" : "pending",
        live && step1 ? scheduleAfter(startBase, step1.delay_minutes, settings.send_window).toISOString() : null,
        token(32, "base64url"),
        token(20, "hex"),
        actor,
        now.toISOString(),
      ],
    );
    if (!ins.rows[0]) {
      skipped.push({ contact_id: contactId, reasons: ["Already enrolled in this campaign (this contact or another contact with the same email address)"] });
      continue;
    }
    room--;
    enrolled.push(ins.rows[0].id);
    await logActivity(q, {
      organizationId: rows[0].organization_id,
      opportunityId: rows[0].opportunity_id,
      type: "email_enrolled",
      summary: `${rows[0].name} added to email campaign “${c.name}”`,
      details: { campaign_id: campaignId, enrollment_id: ins.rows[0].id },
      actorId: actor,
    });
  }
  await q.query(`UPDATE email_campaigns SET updated_at = now() WHERE id = $1`, [campaignId]);
  await audit(q, actor, "email_campaign", campaignId, "enroll", { enrolled: enrolled.length, skipped: skipped.length });
  return { enrolled: enrolled.length, enrollment_ids: enrolled, skipped };
}

/** Stop an enrollment (terminal state). Returns false if it was already stopped. */
export async function stopEnrollment(q: Queryable, id: number, status: Exclude<EnrollmentStatus, "pending" | "active" | "paused">, reason: string): Promise<boolean> {
  const { rows } = await q.query(
    `UPDATE email_sequence_enrollments SET status = $2, stop_reason = $3, stopped_at = now(), next_send_at = NULL, claim_token = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('pending', 'active', 'paused') RETURNING id`,
    [id, status, reason],
  );
  return rows.length > 0;
}

export async function pauseEnrollment(q: Queryable, id: number, actor: number, reason = "Paused by user") {
  const e = await getEnrollment(q, id);
  if (!["pending", "active"].includes(e.status)) throw new HttpError(409, `Enrollment is ${e.status}`);
  await q.query(`UPDATE email_sequence_enrollments SET status = 'paused', stop_reason = $2, updated_at = now() WHERE id = $1`, [id, reason]);
  await audit(q, actor, "email_enrollment", id, "pause");
  return getEnrollment(q, id);
}

/**
 * Resume a paused enrollment. If its last send had an ambiguous outcome, the user must decide:
 * "mark_sent" (they confirmed it in the provider's logs) or "resend" (they confirmed it was not sent).
 */
export async function resumeEnrollment(q: Queryable, id: number, actor: number, opts: { ambiguous_resolution?: string } = {}, now = new Date()) {
  const e = await getEnrollment(q, id);
  if (e.status !== "paused") throw new HttpError(409, `Enrollment is ${e.status}, not paused`);
  const c = await getCampaign(q, e.campaign_id);
  if (["cancelled", "completed"].includes(c.status)) throw new HttpError(409, `The campaign is ${c.status}`);
  const settings = campaignSettings(c.settings);
  const { rows: amb } = await q.query<{ id: number; step_id: number; step_order: number }>(
    `SELECT m.id, m.step_id, s.step_order FROM email_messages m JOIN email_sequence_steps s ON s.id = m.step_id WHERE m.enrollment_id = $1 AND m.status IN ('ambiguous', 'sending')`,
    [id],
  );
  let currentStep = e.current_step;
  if (amb[0]) {
    if (opts.ambiguous_resolution === "mark_sent") {
      await q.query(`UPDATE email_messages SET status = 'sent', sent_at = coalesce(sent_at, now()), updated_at = now() WHERE id = $1`, [amb[0].id]);
      currentStep = Math.max(currentStep, amb[0].step_order);
    } else if (opts.ambiguous_resolution === "resend") {
      await q.query(`UPDATE email_messages SET status = 'failed_transient', last_error = 'Marked not sent by user; will retry', updated_at = now() WHERE id = $1`, [amb[0].id]);
    } else {
      throw new HttpError(409, "The last email to this recipient may or may not have been sent. Check the provider's logs, then resume with “mark as sent” or “send again”.", { ambiguous: true });
    }
    await q.query(`INSERT INTO email_send_events (campaign_id, enrollment_id, step_id, message_id, event_type, metadata) VALUES ($1, $2, $3, $4, 'ambiguous_resolved', $5)`, [
      e.campaign_id,
      id,
      amb[0].step_id,
      amb[0].id,
      JSON.stringify({ resolution: opts.ambiguous_resolution, by: actor }),
    ]);
  }
  const live = c.status === "active" || c.status === "scheduled" || c.status === "paused";
  const next = await firstActiveStep(q, e.campaign_id, currentStep);
  const status = c.status === "draft" ? "pending" : live ? "active" : e.status;
  let nextAt: Date | null = null;
  if (status === "active" && next) {
    if (opts.ambiguous_resolution === "mark_sent") nextAt = scheduleAfter(now, next.delay_minutes, settings.send_window);
    else nextAt = alignToWindow(e.next_send_at && new Date(e.next_send_at) > now ? new Date(e.next_send_at) : now, settings.send_window);
  }
  if (status === "active" && !next) {
    await q.query(`UPDATE email_sequence_enrollments SET current_step = $2 WHERE id = $1`, [id, currentStep]);
    await stopEnrollment(q, id, "completed", "All steps sent");
  } else {
    await q.query(
      `UPDATE email_sequence_enrollments SET status = $2, current_step = $3, next_send_at = $4, attempt_count = 0, last_error = NULL, stop_reason = NULL, claim_token = NULL, updated_at = now() WHERE id = $1`,
      [id, status, currentStep, nextAt?.toISOString() ?? null],
    );
  }
  await audit(q, actor, "email_enrollment", id, "resume", opts);
  return getEnrollment(q, id);
}

/* ------------------------------------------------------------------ suppression */

const STOP_STATUS: Record<SuppressionReason, Exclude<EnrollmentStatus, "pending" | "active" | "paused">> = {
  unsubscribed: "unsubscribed",
  complaint: "unsubscribed",
  hard_bounce: "bounced",
  invalid: "bounced",
  blocked: "bounced",
  manual: "cancelled",
};

/** Add an address to the suppression list and stop every live enrollment for it, in every campaign. */
export async function suppressEmail(q: Queryable, rawEmail: string, reason: SuppressionReason, source: string, opts: { actorId?: number | null; details?: object } = {}) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new HttpError(400, "A valid email address is required");
  const ins = await q.query(`INSERT INTO email_suppressions (email, reason, source, details, created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING RETURNING id`, [
    email,
    reason,
    source,
    JSON.stringify(opts.details ?? {}),
    opts.actorId ?? null,
  ]);
  const { rows } = await q.query<{ id: number; campaign_id: number; organization_id: number | null; opportunity_id: number | null; name: string }>(
    `SELECT e.id, e.campaign_id, e.organization_id, e.opportunity_id, c.name FROM email_sequence_enrollments e JOIN email_campaigns c ON c.id = e.campaign_id
      WHERE e.email = $1 AND e.status IN ('pending', 'active', 'paused')`,
    [email],
  );
  const label = { unsubscribed: "unsubscribed", complaint: "marked an email as spam", hard_bounce: "hard bounce", invalid: "invalid address", blocked: "blocked by provider", manual: "suppressed manually" }[reason];
  for (const e of rows) {
    if (!(await stopEnrollment(q, e.id, STOP_STATUS[reason], `Suppressed: ${label}`))) continue;
    if (e.organization_id) {
      await logActivity(q, {
        organizationId: e.organization_id,
        opportunityId: e.opportunity_id,
        type: reason === "unsubscribed" || reason === "complaint" ? "email_unsubscribed" : reason === "manual" ? "email_stopped" : "email_bounced",
        summary: `Email sequence “${e.name}” stopped for ${email}: ${label}`,
        details: { campaign_id: e.campaign_id, enrollment_id: e.id, reason },
        actorId: opts.actorId ?? null,
      });
    }
  }
  return { email, added: ins.rows.length > 0, stopped: rows.length };
}

/* ------------------------------------------------------------------ rendering */

export function footerInfo(unsubscribeToken: string): FooterInfo {
  const c = emailConfig();
  const base = c.publicBaseUrl ?? `http://localhost:${process.env.API_PORT || 3001}`;
  return {
    senderName: senderDisplayName(c),
    company: c.senderCompany,
    address: c.senderAddress ?? (c.mode === "dry_run" ? "[[Postal address — set EMAIL_SENDER_ADDRESS]]" : null),
    unsubscribeUrl: `${base}/api/email/unsubscribe/${unsubscribeToken}`,
  };
}

export async function recipientVars(q: Queryable, contactId: number | null, fallback?: { name?: string | null; email?: string | null }): Promise<TemplateVars> {
  const c = emailConfig();
  // {{sender.name}} always resolves: EMAIL_SENDER_NAME, else DEFAULT_SENDER_NAME ("WSIS Team").
  const base: TemplateVars = { "sender.name": senderDisplayName(c), "sender.company": c.senderCompany };
  if (!contactId) return { ...base, "contact.name": fallback?.name ?? null, "contact.first_name": firstName(fallback?.name) };
  const { rows } = await q.query<{ name: string; designation: string | null; org_name: string; org_type: string; sector: string | null; area: string | null }>(
    `SELECT c.name, c.designation, org.name AS org_name, org.org_type, org.sector, org.area FROM contacts c JOIN organizations org ON org.id = c.organization_id WHERE c.id = $1`,
    [contactId],
  );
  const r = rows[0];
  if (!r) return base;
  return {
    ...base,
    "contact.name": r.name,
    "contact.first_name": firstName(r.name),
    "contact.designation": r.designation,
    "organization.name": r.org_name,
    "organization.org_type": r.org_type === "Other" ? null : r.org_type,
    "organization.sector": r.sector,
    "organization.area": r.area,
  };
}

/** Content for one recipient × step: an approved personalized draft wins over the step template. */
export async function contentFor(q: Queryable, enrollmentId: number | null, step: SequenceStep) {
  if (enrollmentId) {
    const { rows } = await q.query<{ subject: string; text_body: string; status: string }>(`SELECT subject, text_body, status FROM email_personalized_drafts WHERE enrollment_id = $1 AND step_id = $2`, [enrollmentId, step.id]);
    if (rows[0]?.status === "approved") return { subject: rows[0].subject, text: rows[0].text_body, html: null, personalized: true, pendingDraft: false };
    if (rows[0]?.status === "pending_review") return { subject: step.subject_template, text: step.text_template, html: step.html_template, personalized: false, pendingDraft: true };
  }
  return { subject: step.subject_template, text: step.text_template, html: step.html_template, personalized: false, pendingDraft: false };
}

/* ------------------------------------------------------------------ approval & lifecycle */

export async function approvalIssues(q: Queryable, campaignId: number) {
  const steps = (await listSteps(q, campaignId)).filter((s) => s.active);
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (!steps.length) blocking.push("Add at least one active sequence step");
  for (const s of steps) {
    const ph = findPlaceholders(s.subject_template, s.text_template, s.html_template);
    if (ph.length) blocking.push(`Step ${s.step_order} still has placeholders to fill in: ${ph.map((p) => `[[${p}]]`).join(", ")}`);
  }
  const { rows: enr } = await q.query<{ id: number; contact_id: number | null; recipient_name: string | null; email: string }>(
    `SELECT id, contact_id, recipient_name, email FROM email_sequence_enrollments WHERE campaign_id = $1 AND status IN ('pending', 'active', 'paused') ORDER BY id LIMIT 500`,
    [campaignId],
  );
  if (!enr.length) blocking.push("Add at least one eligible recipient");
  let missingCount = 0;
  for (const e of enr) {
    const vars = await recipientVars(q, e.contact_id, { name: e.recipient_name });
    for (const s of steps) {
      const content = await contentFor(q, e.id, s);
      const r = renderEmail(content, vars, footerInfo("preview"));
      if (r.missing.length) {
        missingCount++;
        if (missingCount <= 5) warnings.push(`${e.recipient_name ?? e.email}, step ${s.step_order}: no value for ${r.missing.map((m) => `{{${m}}}`).join(", ")} — add a fallback like {{${r.missing[0]}|…}} or this email will be held`);
      }
      if (content.pendingDraft) warnings.push(`${e.recipient_name ?? e.email}, step ${s.step_order}: personalized draft awaiting review — it will be held until approved or rejected`);
    }
  }
  if (missingCount > 5) warnings.push(`…and ${missingCount - 5} more recipient/step combinations with missing values`);
  return { blocking, warnings };
}

export async function approveCampaign(q: Queryable, id: number, actor: number) {
  const c = await getCampaign(q, id);
  if (["completed", "cancelled"].includes(c.status)) throw new HttpError(409, `Campaign is ${c.status}`);
  const issues = await approvalIssues(q, id);
  if (issues.blocking.length) throw new HttpError(422, "The campaign is not ready for approval", issues);
  await q.query(`UPDATE email_campaigns SET approved_version = content_version, approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $1`, [id, actor]);
  await audit(q, actor, "email_campaign", id, "approve", { content_version: c.content_version, warnings: issues.warnings });
  return { campaign: await getCampaign(q, id), warnings: issues.warnings };
}

async function scheduleLiveEnrollments(q: Queryable, campaignId: number, base: Date, settings: Required<CampaignSettings>) {
  const step1 = await firstActiveStep(q, campaignId);
  const first = step1 ? scheduleAfter(base, step1.delay_minutes, settings.send_window) : null;
  await q.query(`UPDATE email_sequence_enrollments SET status = 'active', next_send_at = $2, updated_at = now() WHERE campaign_id = $1 AND status = 'pending'`, [campaignId, first?.toISOString() ?? null]);
}

/** Activate an approved campaign. `confirm_recipients` must equal the live recipient count (bulk-send guard). */
export async function activateCampaign(q: Queryable, id: number, actor: number, b: { start_at?: unknown; confirm_recipients?: unknown }, now = new Date()) {
  const c = await getCampaign(q, id);
  if (c.status !== "draft") throw new HttpError(409, c.status === "paused" ? "Use resume for a paused campaign" : `Campaign is already ${c.status}`);
  if (c.approved_version !== c.content_version) throw new HttpError(409, "The campaign must be approved (after its latest edit) before it can be activated");
  const issues = await approvalIssues(q, id);
  if (issues.blocking.length) throw new HttpError(422, "The campaign is not ready", issues);
  const cfg = emailConfig();
  if (cfg.mode === "live") {
    const problems = liveProblems(cfg);
    if (problems.length) throw new HttpError(409, "Live sending is not configured", { problems });
  }
  const { rows: cnt } = await q.query<{ n: number }>(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND status IN ('pending', 'active', 'paused')`, [id]);
  if (Number(b.confirm_recipients) !== cnt[0].n) throw new HttpError(400, `Confirm the number of recipients: this campaign will email ${cnt[0].n} people`, { recipients: cnt[0].n });
  let start = now;
  if (b.start_at != null && b.start_at !== "") {
    const t = new Date(String(b.start_at));
    if (Number.isNaN(t.getTime())) throw new HttpError(400, "start_at must be an ISO date-time");
    if (t.getTime() > now.getTime() + 365 * 86400000) throw new HttpError(400, "start_at must be within a year");
    if (t > now) start = t;
  }
  const scheduled = start > now;
  const settings = campaignSettings(c.settings);
  await q.query(
    `UPDATE email_campaigns SET status = $2, send_mode = $3, scheduled_start_at = $4, activated_at = $5, updated_at = now() WHERE id = $1`,
    [id, scheduled ? "scheduled" : "active", cfg.mode, scheduled ? start.toISOString() : null, now.toISOString()],
  );
  await scheduleLiveEnrollments(q, id, start, settings);
  await audit(q, actor, "email_campaign", id, "activate", { mode: cfg.mode, recipients: cnt[0].n, start_at: start.toISOString() });
  return getCampaign(q, id);
}

export async function pauseCampaign(q: Queryable, id: number, actor: number) {
  const c = await getCampaign(q, id);
  if (!["active", "scheduled"].includes(c.status)) throw new HttpError(409, `Only an active or scheduled campaign can be paused (it is ${c.status})`);
  await q.query(`UPDATE email_campaigns SET status = 'paused', paused_at = now(), updated_at = now() WHERE id = $1`, [id]);
  await audit(q, actor, "email_campaign", id, "pause");
  return getCampaign(q, id);
}

export async function resumeCampaign(q: Queryable, id: number, actor: number, now = new Date()) {
  const c = await getCampaign(q, id);
  if (c.status !== "paused") throw new HttpError(409, `Only a paused campaign can be resumed (it is ${c.status})`);
  if (c.approved_version !== c.content_version) throw new HttpError(409, "The sequence changed while paused. Approve it again before resuming.");
  const cfg = emailConfig();
  if (c.send_mode && c.send_mode !== cfg.mode) {
    throw new HttpError(409, `This campaign was activated in ${c.send_mode === "dry_run" ? "dry-run" : "live"} mode but the server is in ${cfg.mode === "dry_run" ? "dry-run" : "live"} mode. Duplicate it to run in the current mode.`);
  }
  if (cfg.mode === "live") {
    const problems = liveProblems(cfg);
    if (problems.length) throw new HttpError(409, "Live sending is not configured", { problems });
  }
  const scheduled = c.scheduled_start_at && new Date(c.scheduled_start_at) > now;
  await q.query(`UPDATE email_campaigns SET status = $2, paused_at = NULL, updated_at = now() WHERE id = $1`, [id, scheduled ? "scheduled" : "active"]);
  await scheduleLiveEnrollments(q, id, scheduled ? new Date(c.scheduled_start_at!) : now, campaignSettings(c.settings));
  await audit(q, actor, "email_campaign", id, "resume");
  return getCampaign(q, id);
}

export async function cancelCampaign(q: Queryable, id: number, actor: number) {
  const c = await getCampaign(q, id);
  if (["cancelled", "completed"].includes(c.status)) throw new HttpError(409, `Campaign is already ${c.status}`);
  await q.query(`UPDATE email_campaigns SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`, [id]);
  const { rows } = await q.query<{ id: number }>(`SELECT id FROM email_sequence_enrollments WHERE campaign_id = $1 AND status IN ('pending', 'active', 'paused')`, [id]);
  for (const e of rows) await stopEnrollment(q, e.id, "cancelled", "Campaign cancelled");
  await audit(q, actor, "email_campaign", id, "cancel", { enrollments_stopped: rows.length });
  return getCampaign(q, id);
}

/* ------------------------------------------------------------------ analytics */

export async function campaignAnalytics(q: Queryable, id: number): Promise<CampaignAnalytics> {
  await getCampaign(q, id);
  const one = async (sql: string) => (await q.query<{ n: number }>(sql, [id])).rows[0]?.n ?? 0;
  const enrolled = await one(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND status <> 'cancelled'`);
  const eligible_live = await one(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND status IN ('pending', 'active', 'paused')`);
  const messages_attempted = await one(`SELECT count(*)::int n FROM email_messages WHERE campaign_id = $1`);
  const accepted = await one(`SELECT count(*)::int n FROM email_messages WHERE campaign_id = $1 AND status = 'sent'`);
  const delivered = await one(`SELECT count(*)::int n FROM email_messages WHERE campaign_id = $1 AND delivered_at IS NOT NULL`);
  const failed = await one(`SELECT count(*)::int n FROM email_messages WHERE campaign_id = $1 AND status = 'failed_permanent'`);
  const ambiguous = await one(`SELECT count(*)::int n FROM email_messages WHERE campaign_id = $1 AND status IN ('ambiguous', 'sending')`);
  const soft_bounced = await one(`SELECT count(DISTINCT message_id)::int n FROM email_send_events WHERE campaign_id = $1 AND event_type = 'soft_bounce'`);
  const hard_bounced = await one(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND status = 'bounced'`);
  const replied = await one(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND status = 'replied'`);
  const unsubscribed = await one(`SELECT count(*)::int n FROM email_sequence_enrollments WHERE campaign_id = $1 AND status = 'unsubscribed'`);
  const recipients_contacted = await one(`SELECT count(DISTINCT enrollment_id)::int n FROM email_messages WHERE campaign_id = $1 AND status = 'sent'`);
  const meetings = (await getCampaign(q, id)).meetings;
  const by_step = (
    await q.query<{ step_order: number; accepted: number; delivered: number; replied_after: number }>(
      `SELECT s.step_order,
              count(m.id) FILTER (WHERE m.status = 'sent')::int AS accepted,
              count(m.id) FILTER (WHERE m.delivered_at IS NOT NULL)::int AS delivered,
              count(DISTINCT e.id) FILTER (WHERE e.status = 'replied' AND e.current_step = s.step_order)::int AS replied_after
         FROM email_sequence_steps s
         LEFT JOIN email_messages m ON m.step_id = s.id
         LEFT JOIN email_sequence_enrollments e ON e.id = m.enrollment_id
        WHERE s.campaign_id = $1 GROUP BY s.step_order ORDER BY s.step_order`,
      [id],
    )
  ).rows;
  const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
  return {
    enrolled,
    eligible_live,
    messages_attempted,
    accepted,
    delivered,
    soft_bounced,
    hard_bounced,
    failed,
    ambiguous,
    replied,
    unsubscribed,
    meetings,
    recipients_contacted,
    reply_rate: rate(replied, recipients_contacted),
    bounce_rate: rate(hard_bounced, accepted),
    unsubscribe_rate: rate(unsubscribed, recipients_contacted),
    by_step,
  };
}

export async function sentToday(q: Queryable, mode: string, now = new Date()): Promise<number> {
  // "Today" is the India Standard Time calendar day, like the rest of WSIS.
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const startIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS;
  const { rows } = await q.query<{ n: number }>(`SELECT count(*)::int n FROM email_messages WHERE send_mode = $1 AND created_at >= $2 AND status IN ('sending', 'sent', 'ambiguous')`, [
    mode,
    new Date(startIst).toISOString(),
  ]);
  return rows[0].n;
}
