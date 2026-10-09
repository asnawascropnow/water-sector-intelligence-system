import React, { useState } from "react";
import { AlertTriangle, FlaskConical, Radio } from "lucide-react";
import type { CampaignStatus, EmailSystemStatus, EnrollmentStatus } from "../../../shared/email";
import { Badge, Button, Field, Input, Modal, type Tone } from "../ui";

export const CAMPAIGN_TONE: Record<CampaignStatus, Tone> = {
  draft: "neutral",
  scheduled: "purple",
  active: "green",
  paused: "amber",
  completed: "blue",
  cancelled: "red",
};

export const ENROLLMENT_TONE: Record<EnrollmentStatus, Tone> = {
  pending: "neutral",
  active: "green",
  paused: "amber",
  replied: "purple",
  completed: "blue",
  unsubscribed: "red",
  bounced: "red",
  cancelled: "neutral",
  failed: "red",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <Badge tone={CAMPAIGN_TONE[status]} dot>
      {cap(status)}
    </Badge>
  );
}
export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  return (
    <Badge tone={ENROLLMENT_TONE[status]} dot>
      {cap(status)}
    </Badge>
  );
}

export const EVENT_LABEL: Record<string, { label: string; tone: Tone }> = {
  attempt: { label: "Send attempt", tone: "neutral" },
  accepted: { label: "Accepted by provider", tone: "green" },
  dry_run_accepted: { label: "Dry run (not sent)", tone: "purple" },
  failed_transient: { label: "Temporary failure — will retry", tone: "amber" },
  failed_permanent: { label: "Failed", tone: "red" },
  ambiguous: { label: "Outcome unknown — held", tone: "amber" },
  ambiguous_resolved: { label: "Unknown outcome resolved", tone: "blue" },
  request: { label: "Provider: sent", tone: "blue" },
  delivered: { label: "Delivered", tone: "green" },
  soft_bounce: { label: "Soft bounce", tone: "amber" },
  hard_bounce: { label: "Hard bounce", tone: "red" },
  blocked: { label: "Blocked", tone: "red" },
  invalid: { label: "Invalid address", tone: "red" },
  spam: { label: "Spam complaint", tone: "red" },
  unsubscribed: { label: "Unsubscribed", tone: "red" },
  deferred: { label: "Deferred", tone: "amber" },
  opened: { label: "Opened (unreliable)", tone: "neutral" },
  click: { label: "Link clicked", tone: "blue" },
  error: { label: "Provider error", tone: "red" },
  reply: { label: "Reply received", tone: "purple" },
  auto_reply: { label: "Auto-reply (ignored)", tone: "neutral" },
  test_sent: { label: "Test email sent", tone: "blue" },
  test_failed: { label: "Test email failed", tone: "red" },
};

export function EventBadge({ type }: { type: string }) {
  const e = EVENT_LABEL[type] ?? { label: cap(type), tone: "neutral" as Tone };
  return <Badge tone={e.tone}>{e.label}</Badge>;
}

/** "Day 1 · immediately", "+3 days" … from delay_minutes. */
export function delayLabel(minutes: number, first: boolean) {
  if (minutes === 0) return first ? "Immediately when the sequence starts" : "Right after the previous email";
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  const parts = [d && `${d} day${d === 1 ? "" : "s"}`, h && `${h} hour${h === 1 ? "" : "s"}`, m && `${m} min`].filter(Boolean).join(" ");
  return `${parts} after ${first ? "the sequence starts" : "the previous email"}`;
}

/** Approximate calendar day of each step, assuming every email goes out on schedule (Day 1 = first email). */
export function dayNumbers(delays: number[]) {
  let total = 0;
  return delays.map((d) => {
    total += d;
    return 1 + Math.floor(total / 1440);
  });
}

export function ModeBanner({ status }: { status: EmailSystemStatus | null }) {
  if (!status) return null;
  if (status.mode === "dry_run") {
    return (
      <div className="mb-5 flex gap-3 rounded-xl border border-violet-200 dark:border-violet-500/30 bg-violet-50 dark:bg-violet-500/10 px-4 py-3 text-sm text-violet-900 dark:text-violet-200">
        <FlaskConical size={16} className="shrink-0 mt-0.5" />
        <div>
          <b>Dry-run mode.</b> Sequences run end-to-end but no email leaves the server — every “send” is recorded as a dry run. Set <code>EMAIL_DRY_RUN=false</code> on the server, with Brevo configured, to send for real.
          {!status.scheduler_enabled && <> The background scheduler is off (<code>EMAIL_SCHEDULER_ENABLED=false</code>).</>}
          {status.sender.name_is_default && <> Sender name defaults to “{status.sender.name}” (set <code>EMAIL_SENDER_NAME</code> to change it).</>}
        </div>
      </div>
    );
  }
  return (
    <div className="mb-5 flex gap-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-200">
      <Radio size={16} className="shrink-0 mt-0.5" />
      <div>
        <b>Live sending via {status.provider}</b> from {status.sender.name} &lt;{status.sender.email}&gt;. {status.sent_today}/{status.limits.daily_send_limit} emails sent today.
        {!status.reply_detection && <> Reply detection is not configured; mark replies manually.</>}
        {status.live_problems.length > 0 && (
          <div className="mt-1 flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {status.live_problems.join("; ")}
          </div>
        )}
      </div>
    </div>
  );
}

/** Confirmation for high-impact actions. Optionally require typing a value (e.g. the number of recipients). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  requireText,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireText?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = !requireText || typed.trim() === requireText;
  return (
    <Modal
      open={open}
      onClose={() => {
        setTyped("");
        onClose();
      }}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={!ok}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                setTyped("");
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-[var(--text-2)] space-y-3">{children}</div>
      {requireText && (
        <Field label={`Type ${requireText} to confirm`} className="mt-4">
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" autoFocus />
        </Field>
      )}
    </Modal>
  );
}

/** Rendered HTML email in a fully sandboxed iframe (no scripts, no same-origin access). */
export function EmailFrame({ html, title = "Email preview" }: { html: string; title?: string }) {
  return <iframe title={title} sandbox="" srcDoc={html} className="w-full h-[420px] rounded-lg border border-[var(--border)] bg-white" />;
}

export function Pager({ total, offset, setOffset, size = 25 }: { total: number; offset: number; setOffset: (n: number) => void; size?: number }) {
  if (total <= size) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-3 text-xs text-[var(--text-3)]">
      {offset + 1}–{Math.min(offset + size, total)} of {total}
      <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - size))}>
        Previous
      </Button>
      <Button size="sm" variant="ghost" disabled={offset + size >= total} onClick={() => setOffset(offset + size)}>
        Next
      </Button>
    </div>
  );
}

