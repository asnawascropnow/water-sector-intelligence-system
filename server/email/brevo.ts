import type { EmailConfig } from "./config";
import { webhookTokenMatches, type EmailProvider, type InboundEmail, type NormalizedEventType, type OutboundEmail, type ProviderEvent, type SendResult } from "./provider";

/**
 * Brevo (https://developers.brevo.com) implementation.
 *  - Send:     POST {base}/smtp/email, header `api-key`; 201 → { messageId }.
 *  - Events:   transactional webhooks (event = request, delivered, soft_bounce, hard_bounce, blocked, spam,
 *              invalid_email, deferred, opened, unique_opened, click, error, unsubscribed). Our reference is
 *              sent in the `X-Mailin-custom` header, which Brevo echoes back in webhook payloads.
 *  - Replies:  inbound parsing webhook (event inboundEmailProcessed, body.items[]) on a receiving subdomain.
 *  - Auth:     Brevo webhooks are not signed; they are authenticated with a shared token (see webhookTokenMatches).
 *  - Brevo documents no idempotency key for /smtp/email, so ambiguous outcomes are never retried automatically.
 */

const EVENT_MAP: Record<string, NormalizedEventType> = {
  request: "request",
  sent: "request",
  delivered: "delivered",
  soft_bounce: "soft_bounce",
  softbounce: "soft_bounce",
  hard_bounce: "hard_bounce",
  hardbounce: "hard_bounce",
  blocked: "blocked",
  spam: "spam",
  invalid_email: "invalid",
  invalid: "invalid",
  deferred: "deferred",
  opened: "opened",
  unique_opened: "opened",
  click: "click",
  error: "error",
  unsubscribed: "unsubscribed",
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

function occurredAt(e: Record<string, unknown>): string {
  const epochMs = Number(e.ts_epoch);
  if (Number.isFinite(epochMs) && epochMs > 1e12) return new Date(epochMs).toISOString();
  const s = Number(e.ts_event ?? e.ts);
  if (Number.isFinite(s) && s > 1e9) return new Date(s * 1000).toISOString();
  const d = str(e.date);
  if (d && !Number.isNaN(Date.parse(d))) return new Date(d).toISOString();
  return new Date().toISOString();
}

function classifyHttp(status: number): SendResult["status"] {
  if (status === 201 || status === 202) return "accepted";
  if (status === 429 || status === 503) return "transient";
  if (status >= 500) return "ambiguous";
  return "permanent";
}

/** Network errors before the request reached Brevo are retryable; anything after that is ambiguous. */
function classifyNetworkError(err: unknown): SendResult {
  const e = err as { name?: string; message?: string; cause?: { code?: string } };
  const code = e?.cause?.code ?? "";
  if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_CONNECT_TIMEOUT"].includes(code)) {
    return { status: "transient", error: `Could not reach Brevo (${code})` };
  }
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return { status: "ambiguous", error: "Timed out waiting for Brevo; the email may or may not have been accepted" };
  return { status: "ambiguous", error: `Connection to Brevo failed mid-request (${code || e?.message || "unknown"}); the email may or may not have been accepted` };
}

export function createBrevoProvider(c: EmailConfig, fetchImpl: typeof fetch = fetch): EmailProvider {
  const headers = () => ({ "api-key": c.brevoApiKey ?? "", accept: "application/json", "content-type": "application/json" });
  return {
    name: "brevo",

    async send(msg: OutboundEmail): Promise<SendResult> {
      if (!c.brevoApiKey) return { status: "permanent", error: "BREVO_API_KEY is not configured" };
      const body = {
        sender: { email: msg.from.email, name: msg.from.name },
        to: [{ email: msg.to.email, ...(msg.to.name ? { name: msg.to.name } : {}) }],
        ...(msg.replyTo ? { replyTo: { email: msg.replyTo.email, ...(msg.replyTo.name ? { name: msg.replyTo.name } : {}) } } : {}),
        subject: msg.subject,
        htmlContent: msg.html,
        textContent: msg.text,
        headers: { "X-Mailin-custom": msg.reference, ...(msg.headers ?? {}) },
        ...(msg.tags?.length ? { tags: msg.tags } : {}),
      };
      let res: Response;
      try {
        res = await fetchImpl(`${c.brevoApiBase}/smtp/email`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      } catch (err) {
        return classifyNetworkError(err);
      }
      const data = (await res.json().catch(() => null)) as { messageId?: string; messageIds?: string[]; code?: string; message?: string } | null;
      const status = classifyHttp(res.status);
      if (status === "accepted") return { status, providerMessageId: data?.messageId ?? data?.messageIds?.[0] ?? null };
      // Only Brevo's error code/message are kept — never request headers.
      return { status, httpStatus: res.status, error: `Brevo ${res.status}${data?.code ? ` ${data.code}` : ""}: ${(data?.message ?? res.statusText ?? "").slice(0, 300)}` };
    },

    verifyWebhook: (req) => webhookTokenMatches(req, c.webhookToken),

    parseEvents(body: unknown): ProviderEvent[] {
      const items = (Array.isArray(body) ? body : [body]).filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
      const out: ProviderEvent[] = [];
      for (const e of items) {
        const raw = str(e.event)?.toLowerCase().replace(/\s+/g, "_");
        const type = raw ? EVENT_MAP[raw] ?? EVENT_MAP[raw.replace(/_/g, "")] : undefined;
        if (!type) continue;
        const providerMessageId = str(e["message-id"]) ?? str(e.messageId) ?? str(e["message_id"]);
        const email = str(e.email)?.toLowerCase() ?? null;
        const at = occurredAt(e);
        const reference = str(e["X-Mailin-custom"]) ?? str(e["x-mailin-custom"]);
        out.push({
          type,
          email,
          providerMessageId,
          reference,
          occurredAt: at,
          reason: str(e.reason),
          dedupeKey: `brevo:${raw}:${providerMessageId ?? ""}:${email ?? ""}:${str(e.ts_epoch) ?? str(e.ts_event) ?? str(e.ts) ?? str(e.date) ?? ""}:${str(e.link) ?? ""}`,
          // Keep only non-personal, useful fields. No IPs, user agents, or full payload.
          raw: { event: raw, reason: str(e.reason), subject: str(e.subject), tags: Array.isArray(e.tags) ? e.tags : str(e.tag), link: str(e.link) },
        });
      }
      return out;
    },

    parseInbound(body: unknown): InboundEmail[] {
      const items = (body as { items?: unknown[] })?.items;
      if (!Array.isArray(items)) return [];
      return items
        .filter((x): x is Record<string, any> => !!x && typeof x === "object")
        .map((m) => {
          const hdrs = (m.Headers && typeof m.Headers === "object" ? m.Headers : {}) as Record<string, unknown>;
          const header = (name: string): string | null => {
            const key = Object.keys(hdrs).find((k) => k.toLowerCase() === name.toLowerCase());
            const v = key ? hdrs[key] : null;
            return Array.isArray(v) ? str(v[0]) : str(v);
          };
          const subject = str(m.Subject);
          const autoSubmitted = header("Auto-Submitted");
          const precedence = header("Precedence")?.toLowerCase();
          const autoReply =
            (!!autoSubmitted && autoSubmitted.toLowerCase() !== "no") ||
            !!header("X-Autoreply") ||
            !!header("X-Autorespond") ||
            precedence === "auto_reply" ||
            precedence === "bulk" ||
            precedence === "junk" ||
            /^(auto(matic)?[\s-]?reply|out of (the )?office|autosvar|abwesenheit)/i.test(subject ?? "");
          const recipients = [
            ...(Array.isArray(m.Recipients) ? m.Recipients : []),
            ...(Array.isArray(m.To) ? m.To.map((t: any) => t?.Address) : []),
          ]
            .map((r) => str(r)?.toLowerCase())
            .filter((r): r is string => !!r);
          const refs = header("References");
          const uuid = Array.isArray(m.Uuid) ? str(m.Uuid[0]) : str(m.Uuid);
          return {
            from: str(m.From?.Address)?.toLowerCase() ?? null,
            fromName: str(m.From?.Name),
            recipients: [...new Set(recipients)],
            subject,
            inReplyTo: str(m.InReplyTo) ?? header("In-Reply-To"),
            references: refs ? refs.split(/\s+/).filter(Boolean) : [],
            messageId: str(m.MessageId),
            text: str(m.ExtractedMarkdownMessage) ?? str(m.RawTextBody),
            autoReply,
            dedupeKey: `brevo-inbound:${uuid ?? str(m.MessageId) ?? `${str(m.From?.Address)}:${str(m.SentAtDate)}`}`,
          };
        });
    },

    async suppress(email: string) {
      if (!c.brevoApiKey || !c.syncSuppressions) return;
      // Brevo has no documented "add to transactional blocklist" call. Blocklisting the contact is the closest
      // supported option; WSIS's own suppression list remains the authority and is checked before every send.
      const url = `${c.brevoApiBase}/contacts/${encodeURIComponent(email)}?identifierType=email_id`;
      const res = await fetchImpl(url, { method: "PUT", headers: headers(), body: JSON.stringify({ emailBlacklisted: true }), signal: AbortSignal.timeout(15000) });
      if (res.status === 404) {
        await fetchImpl(`${c.brevoApiBase}/contacts`, { method: "POST", headers: headers(), body: JSON.stringify({ email, emailBlacklisted: true }), signal: AbortSignal.timeout(15000) });
      }
    },
  };
}
