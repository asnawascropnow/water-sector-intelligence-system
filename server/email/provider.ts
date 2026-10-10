import crypto from "node:crypto";
import type { Request } from "express";
import { emailConfig, type EmailConfig } from "./config";
import { createBrevoProvider } from "./brevo";

/** Provider-neutral email interface. Brevo is the first implementation; others can be added behind it. */

export interface OutboundEmail {
  to: { email: string; name?: string | null };
  from: { email: string; name: string };
  replyTo?: { email: string; name?: string | null } | null;
  subject: string;
  html: string;
  text: string;
  /** Extra headers (e.g. List-Unsubscribe). */
  headers?: Record<string, string>;
  /** Our own reference, echoed back by the provider in webhook events where supported. */
  reference: string;
  tags?: string[];
}

/**
 * Outcome classes drive retry policy:
 *  - accepted:  provider took the message
 *  - transient: definitely not accepted, safe to retry (rate limited, 503, connection refused)
 *  - permanent: rejected; retrying will not help (invalid address, auth, bad request)
 *  - ambiguous: the provider may or may not have accepted it (timeout after sending, 500/502/504).
 *               Never retried automatically, to avoid sending twice.
 */
export type SendResult =
  | { status: "accepted"; providerMessageId: string | null }
  | { status: "transient" | "permanent" | "ambiguous"; error: string; httpStatus?: number };

export type NormalizedEventType =
  | "delivered"
  | "soft_bounce"
  | "hard_bounce"
  | "blocked"
  | "invalid"
  | "spam"
  | "unsubscribed"
  | "deferred"
  | "opened"
  | "click"
  | "error"
  | "request";

export interface ProviderEvent {
  type: NormalizedEventType;
  email: string | null;
  providerMessageId: string | null;
  reference: string | null; // our OutboundEmail.reference, when echoed back
  occurredAt: string; // ISO
  dedupeKey: string;
  reason: string | null;
  raw: Record<string, unknown>; // sanitized subset kept for audit
}

export interface InboundEmail {
  from: string | null;
  fromName: string | null;
  recipients: string[];
  subject: string | null;
  inReplyTo: string | null;
  references: string[];
  messageId: string | null;
  text: string | null;
  autoReply: boolean;
  dedupeKey: string;
}

export interface EmailProvider {
  readonly name: string;
  send(msg: OutboundEmail): Promise<SendResult>;
  /** Authenticate a webhook request (shared token). */
  verifyWebhook(req: Request): boolean;
  /** Parse a delivery-event webhook body into normalized events. */
  parseEvents(body: unknown): ProviderEvent[];
  /** Parse an inbound (reply) webhook body. */
  parseInbound(body: unknown): InboundEmail[];
  /** Best-effort: tell the provider not to email this address again. */
  suppress?(email: string): Promise<void>;
}

/** Constant-time comparison of a presented secret with the configured one. */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Accepts the shared webhook token as `Authorization: Bearer <token>` (Brevo "auth" bearer option),
 * `X-Webhook-Token: <token>` (Brevo custom-headers option) or HTTP Basic auth whose password is the token
 * (Brevo credentials-in-URL option).
 */
export function webhookTokenMatches(req: Request, token: string | null): boolean {
  if (!token) return false;
  const auth = req.header("authorization") ?? "";
  const custom = req.header("x-webhook-token");
  if (custom && safeEqual(custom, token)) return true;
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer && safeEqual(bearer.trim(), token)) return true;
  const basic = auth.match(/^Basic\s+(.+)$/i)?.[1];
  if (basic) {
    const decoded = Buffer.from(basic, "base64").toString("utf8");
    const pass = decoded.slice(decoded.indexOf(":") + 1);
    if (decoded.includes(":") && safeEqual(pass, token)) return true;
  }
  return false;
}

/** Dry-run provider: records what would be sent; no network access. Used whenever EMAIL_DRY_RUN is not "false". */
export function createDryRunProvider(): EmailProvider & { sent: OutboundEmail[] } {
  const sent: OutboundEmail[] = [];
  const brevo = createBrevoProvider(emailConfig());
  return {
    name: "dry_run",
    sent,
    async send(msg) {
      sent.push(msg);
      if (sent.length > 200) sent.shift();
      return { status: "accepted", providerMessageId: `<dryrun-${crypto.randomUUID()}@wsis.local>` };
    },
    // Webhook parsing is the real provider's so local webhook tests behave the same.
    verifyWebhook: (req) => webhookTokenMatches(req, emailConfig().webhookToken),
    parseEvents: (b) => brevo.parseEvents(b),
    parseInbound: (b) => brevo.parseInbound(b),
  };
}

let override: EmailProvider | null = null;
let dryRun: ReturnType<typeof createDryRunProvider> | null = null;

/** Tests inject a mock provider here. */
export function setEmailProvider(p: EmailProvider | null) {
  override = p;
}

export function getEmailProvider(c: EmailConfig = emailConfig()): EmailProvider {
  if (override) return override;
  if (c.mode === "dry_run") return (dryRun ??= createDryRunProvider());
  if (c.provider === "brevo") return createBrevoProvider(c);
  throw new Error(`Unsupported EMAIL_PROVIDER "${c.provider}"`);
}
