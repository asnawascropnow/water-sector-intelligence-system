import type { Database, Queryable } from "../db";
import { logActivity } from "../lib/log";
import { userName } from "../lib/crm";
import type { SuppressionReason } from "../../shared/email";
import { emailConfig } from "./config";
import type { EmailProvider, InboundEmail, ProviderEvent } from "./provider";
import { parseMessageReference, reconcileAcceptedMessage, recordEmailEvent } from "./scheduler";
import { stopEnrollment, suppressEmail } from "./service";

/**
 * Provider event + reply processing. Every event is stored once (email_send_events.dedupe_key), and its side
 * effects only run when the insert actually happened, so provider retries/duplicates are harmless.
 */

const SUPPRESS_ON: Partial<Record<ProviderEvent["type"], SuppressionReason>> = {
  hard_bounce: "hard_bounce",
  invalid: "invalid",
  blocked: "blocked",
  spam: "complaint",
  unsubscribed: "unsubscribed",
};

async function findMessage(q: Queryable, ev: { providerMessageId: string | null; reference: string | null }) {
  const byRef = parseMessageReference(ev.reference);
  const { rows } = await q.query<{ id: number; campaign_id: number; enrollment_id: number; step_id: number; status: string; provider_message_id: string | null }>(
    `SELECT id, campaign_id, enrollment_id, step_id, status, provider_message_id FROM email_messages
      WHERE ($1::int IS NOT NULL AND id = $1) OR ($2::text IS NOT NULL AND provider_message_id = $2)
      ORDER BY (id = $1) DESC NULLS LAST LIMIT 1`,
    [byRef, ev.providerMessageId],
  );
  return rows[0] ?? null;
}

export async function processProviderEvents(db: Database, events: ProviderEvent[], provider: EmailProvider) {
  let processed = 0;
  let duplicates = 0;
  const toSync: string[] = [];
  for (const ev of events) {
    const fresh = await db.tx(async (q) => {
      const msg = await findMessage(q, ev);
      const inserted = await recordEmailEvent(q, {
        campaignId: msg?.campaign_id ?? null,
        enrollmentId: msg?.enrollment_id ?? null,
        stepId: msg?.step_id ?? null,
        messageId: msg?.id ?? null,
        type: ev.type,
        provider: provider.name,
        providerMessageId: ev.providerMessageId,
        email: ev.email,
        dedupeKey: ev.dedupeKey,
        occurredAt: ev.occurredAt,
        metadata: { ...ev.raw, matched: !!msg },
      });
      if (!inserted) return false;
      if (msg) {
        // A provider event proves the provider accepted the message: reconcile ambiguous sends.
        if (msg.status === "ambiguous" || msg.status === "sending") {
          await q.query(`UPDATE email_messages SET status = 'sent', provider_message_id = coalesce(provider_message_id, $2), sent_at = coalesce(sent_at, $3), updated_at = now() WHERE id = $1`, [
            msg.id,
            ev.providerMessageId,
            ev.occurredAt,
          ]);
          await reconcileAcceptedMessage(q, msg.id);
        }
        if (ev.type === "delivered") await q.query(`UPDATE email_messages SET delivered_at = coalesce(delivered_at, $2) WHERE id = $1`, [msg.id, ev.occurredAt]);
      }
      const reason = SUPPRESS_ON[ev.type];
      if (reason && ev.email) {
        await suppressEmail(q, ev.email, reason, `${provider.name}_webhook`, { details: { event: ev.type, reason: ev.reason, message_id: msg?.id ?? null } });
        if (reason !== "unsubscribed") toSync.push(ev.email);
      }
      return true;
    });
    if (fresh) processed++;
    else duplicates++;
  }
  // Provider-originated suppressions already exist at the provider; nothing to sync back for unsubscribes.
  for (const email of toSync) await provider.suppress?.(email).catch((e) => console.error("[email] suppression sync failed:", (e as Error).message));
  return { processed, duplicates };
}

/* ------------------------------------------------------------------ replies */

interface Match {
  enrollment_id: number;
  campaign_id: number;
  organization_id: number | null;
  opportunity_id: number | null;
  email: string;
  status: string;
  campaign_name: string;
  method: "reply_address" | "in_reply_to" | "sender_address";
}

async function matchReply(q: Queryable, m: InboundEmail): Promise<Match | null> {
  const c = emailConfig();
  const base = `SELECT e.id AS enrollment_id, e.campaign_id, e.organization_id, e.opportunity_id, e.email, e.status, c.name AS campaign_name
                 FROM email_sequence_enrollments e JOIN email_campaigns c ON c.id = e.campaign_id`;
  // 1. Our per-enrollment Reply-To address: reply-<token>@EMAIL_REPLY_DOMAIN
  if (c.replyDomain) {
    for (const r of m.recipients) {
      const t = r.match(/^reply-([0-9a-f]{40})@(.+)$/);
      if (t && t[2] === c.replyDomain) {
        const { rows } = await q.query<Omit<Match, "method">>(`${base} WHERE e.reply_token = $1`, [t[1]]);
        if (rows[0]) return { ...rows[0], method: "reply_address" };
      }
    }
  }
  // 2. Threading headers matching a provider Message-ID we stored
  const ids = [m.inReplyTo, ...m.references].filter((x): x is string => !!x);
  if (ids.length) {
    const { rows } = await q.query<Omit<Match, "method">>(`${base} JOIN email_messages msg ON msg.enrollment_id = e.id WHERE msg.provider_message_id = ANY($1::text[]) ORDER BY e.id DESC LIMIT 1`, [ids]);
    if (rows[0]) return { ...rows[0], method: "in_reply_to" };
  }
  // 3. Sender is a recipient with a live enrollment (inbound domain only receives mail we pointed people to)
  if (m.from) {
    const { rows } = await q.query<Omit<Match, "method">>(`${base} WHERE e.email = $1 AND e.status IN ('active', 'paused') ORDER BY e.id DESC LIMIT 1`, [m.from]);
    if (rows[0]) return { ...rows[0], method: "sender_address" };
  }
  return null;
}

export async function processInbound(db: Database, items: InboundEmail[], provider: EmailProvider) {
  const results: { matched: boolean; stopped: boolean; duplicate: boolean; auto_reply: boolean }[] = [];
  const forwards: { subject: string; text: string; from: string | null; fromName: string | null }[] = [];
  for (const m of items) {
    const r = await db.tx(async (q) => {
      const match = await matchReply(q, m);
      const excerpt = (m.text ?? "").slice(0, 4000);
      const inserted = await recordEmailEvent(q, {
        campaignId: match?.campaign_id ?? null,
        enrollmentId: match?.enrollment_id ?? null,
        stepId: null,
        type: m.autoReply ? "auto_reply" : "reply",
        provider: provider.name,
        providerMessageId: m.messageId,
        email: m.from,
        dedupeKey: m.dedupeKey,
        metadata: { subject: m.subject?.slice(0, 300) ?? null, from_name: m.fromName, match_method: match?.method ?? null, excerpt },
      });
      if (!inserted) return { matched: !!match, stopped: false, duplicate: true, auto_reply: m.autoReply };
      if (!match || m.autoReply) return { matched: !!match, stopped: false, duplicate: false, auto_reply: m.autoReply };
      const stopped = await stopEnrollment(q, match.enrollment_id, "replied", `Reply received (${match.method.replace("_", " ")})`);
      if (match.organization_id) {
        await logActivity(q, {
          organizationId: match.organization_id,
          opportunityId: match.opportunity_id,
          type: "email_reply",
          summary: `Email reply from ${m.from ?? match.email}${m.subject ? `: “${m.subject.slice(0, 120)}”` : ""} (campaign “${match.campaign_name}”)`,
          details: { campaign_id: match.campaign_id, enrollment_id: match.enrollment_id, excerpt: excerpt.slice(0, 1000) },
        });
        // Hand the conversation to a person: follow-up task for the opportunity owner.
        if (stopped) {
          const { rows } = await q.query<{ owner_id: number | null; name: string }>(
            `SELECT o.owner_id, org.name FROM crm_opportunities o JOIN organizations org ON org.id = o.organization_id WHERE o.id = $1`,
            [match.opportunity_id],
          );
          if (rows[0]) {
            const due = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
            await q.query(`INSERT INTO tasks (organization_id, opportunity_id, assigned_to, title, task_type, due_date, priority) VALUES ($1, $2, $3, $4, 'Follow-up', $5, 'High')`, [
              match.organization_id,
              match.opportunity_id,
              rows[0].owner_id,
              `Respond to email reply from ${rows[0].name}`,
              due,
            ]);
            await q.query(`UPDATE crm_opportunities SET next_follow_up = (SELECT min(due_date) FROM tasks WHERE opportunity_id = $1 AND status = 'Pending') WHERE id = $1`, [match.opportunity_id]);
            await logActivity(q, {
              organizationId: match.organization_id,
              opportunityId: match.opportunity_id,
              type: "follow_up_created",
              summary: `Follow-up created for ${due}: Respond to email reply (assigned to ${await userName(q, rows[0].owner_id)})`,
            });
          }
        }
      }
      forwards.push({ from: m.from, fromName: m.fromName, subject: `Reply from ${m.from ?? "recipient"}: ${m.subject ?? "(no subject)"}`, text: `${m.fromName ?? ""} <${m.from ?? ""}> replied to campaign “${match.campaign_name}”.\n\n${excerpt}` });
      return { matched: true, stopped, duplicate: false, auto_reply: false };
    });
    results.push(r);
  }
  // Replies arrive at the inbound domain, not a person's mailbox: forward them to the team.
  const c = emailConfig();
  if (c.replyForwardTo && c.mode === "live") {
    for (const f of forwards) {
      await provider
        .send({
          to: { email: c.replyForwardTo },
          from: { email: c.senderEmail!, name: c.senderName ?? "WSIS" },
          replyTo: f.from ? { email: f.from, name: f.fromName } : null, // answer the prospect directly
          subject: f.subject.slice(0, 250),
          text: f.text,
          html: `<pre style="white-space:pre-wrap;font-family:inherit">${f.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
          reference: "wsis-reply-forward",
        })
        .catch((e) => console.error("[email] reply forward failed:", (e as Error).message));
    }
  }
  return results;
}

/* ------------------------------------------------------------------ unsubscribe */

export async function unsubscribeByToken(db: Database, token: string, provider: EmailProvider | null) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const res = await db.tx(async (q) => {
    const { rows } = await q.query<{ id: number; email: string; campaign_id: number }>(`SELECT id, email, campaign_id FROM email_sequence_enrollments WHERE unsubscribe_token = $1`, [token]);
    if (!rows[0]) return null;
    const r = await suppressEmail(q, rows[0].email, "unsubscribed", "unsubscribe_link", { details: { enrollment_id: rows[0].id, campaign_id: rows[0].campaign_id } });
    await recordEmailEvent(q, { campaignId: rows[0].campaign_id, enrollmentId: rows[0].id, stepId: null, type: "unsubscribed", email: rows[0].email, metadata: { source: "unsubscribe_link" }, dedupeKey: `unsubscribe:${rows[0].id}` });
    return { email: rows[0].email, newly: r.added };
  });
  if (res?.newly && provider?.suppress) await provider.suppress(res.email).catch((e) => console.error("[email] suppression sync failed:", (e as Error).message));
  return res;
}
