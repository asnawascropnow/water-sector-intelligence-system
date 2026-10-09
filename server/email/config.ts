import type { SendMode } from "../../shared/email";

/**
 * Email outreach configuration. Read from the environment on every call so tests can change it.
 * Secrets (BREVO_API_KEY, BREVO_WEBHOOK_TOKEN) are only read here and never returned by the API.
 */

/** Used for {{sender.name}} and the footer when EMAIL_SENDER_NAME is not set (dry-run/local). Live sending still requires EMAIL_SENDER_NAME. */
export const DEFAULT_SENDER_NAME = "WSIS Team";

const num = (v: string | undefined, def: number, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min ? n : def;
};
const list = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const emailConfig = () => ({
  /** Anything other than EMAIL_DRY_RUN=false keeps the module in dry-run: nothing leaves the server. */
  mode: (process.env.EMAIL_DRY_RUN === "false" ? "live" : "dry_run") as SendMode,
  provider: (process.env.EMAIL_PROVIDER || "brevo").toLowerCase(),
  brevoApiKey: process.env.BREVO_API_KEY || null,
  brevoApiBase: process.env.BREVO_API_BASE || "https://api.brevo.com/v3",
  webhookToken: process.env.BREVO_WEBHOOK_TOKEN || null,
  syncSuppressions: process.env.BREVO_SYNC_SUPPRESSIONS === "true",
  senderEmail: process.env.EMAIL_SENDER_EMAIL || null,
  senderName: process.env.EMAIL_SENDER_NAME || null,
  senderCompany: process.env.EMAIL_SENDER_COMPANY || null,
  senderAddress: process.env.EMAIL_SENDER_ADDRESS || null,
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "") || null,
  replyDomain: process.env.EMAIL_REPLY_DOMAIN?.trim().toLowerCase() || null,
  replyForwardTo: process.env.EMAIL_REPLY_FORWARD_TO?.trim() || null,
  listUnsubscribeHeader: process.env.EMAIL_LIST_UNSUBSCRIBE_HEADER !== "false",
  schedulerEnabled: process.env.EMAIL_SCHEDULER_ENABLED !== "false",
  schedulerIntervalMs: num(process.env.EMAIL_SCHEDULER_INTERVAL_SECONDS, 60, 5) * 1000,
  batchSize: num(process.env.EMAIL_WORKER_BATCH_SIZE, 10, 1),
  maxAttempts: num(process.env.EMAIL_MAX_SEND_ATTEMPTS, 4, 1),
  retryBaseMs: num(process.env.EMAIL_RETRY_BASE_SECONDS, 300, 1) * 1000,
  leaseMs: num(process.env.EMAIL_CLAIM_LEASE_SECONDS, 600, 30) * 1000,
  dailySendLimit: num(process.env.EMAIL_DAILY_SEND_LIMIT, 100, 0),
  maxRecipientsPerCampaign: num(process.env.EMAIL_MAX_RECIPIENTS_PER_CAMPAIGN, 200, 1),
  /** Addresses or "@domain" entries allowed to receive *test* emails (the "Send test" button), besides team members' addresses. */
  testRecipients: list(process.env.EMAIL_TEST_RECIPIENTS),
  /** Addresses or "@domain" entries. When set, EVERY email (test or sequence, live or dry-run) must match — a hard safety restriction. */
  recipientAllowlist: list(process.env.EMAIL_RECIPIENT_ALLOWLIST),
  approverRoles: list(process.env.EMAIL_APPROVER_ROLES || "admin,outreach"),
});
export type EmailConfig = ReturnType<typeof emailConfig>;

/** Problems that block live sending. Dry-run works without any of these. */
export function liveProblems(c: EmailConfig = emailConfig()): string[] {
  const p: string[] = [];
  if (c.provider !== "brevo") p.push(`Unsupported EMAIL_PROVIDER "${c.provider}" (supported: brevo)`);
  if (!c.brevoApiKey) p.push("BREVO_API_KEY is not set");
  if (!c.senderEmail) p.push("EMAIL_SENDER_EMAIL is not set (must be a sender verified in Brevo)");
  if (!c.senderName) p.push("EMAIL_SENDER_NAME is not set");
  if (!c.senderAddress) p.push("EMAIL_SENDER_ADDRESS is not set (postal address shown in every email footer)");
  if (!c.publicBaseUrl) p.push("PUBLIC_BASE_URL is not set (needed for unsubscribe links)");
  else if (!/^https:\/\//.test(c.publicBaseUrl)) p.push("PUBLIC_BASE_URL must use https for live sending");
  if (!c.webhookToken) p.push("BREVO_WEBHOOK_TOKEN is not set (bounce/unsubscribe webhooks would be rejected)");
  return p;
}

export function matchesList(email: string, entries: string[]): boolean {
  const e = email.toLowerCase();
  return entries.some((r) => (r.startsWith("@") ? e.endsWith(r) : e === r));
}

/** EMAIL_RECIPIENT_ALLOWLIST check for every email. Empty list = no restriction. */
export function recipientAllowed(email: string, c: EmailConfig = emailConfig()): boolean {
  return !c.recipientAllowlist.length || matchesList(email, c.recipientAllowlist);
}

export const senderDisplayName = (c: EmailConfig = emailConfig()) => c.senderName ?? DEFAULT_SENDER_NAME;
