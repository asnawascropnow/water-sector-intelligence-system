import React, { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, BarChart3, CheckCircle2, Copy, Pause, Play, Rocket, Settings2, ShieldCheck, XCircle } from "lucide-react";
import type { CampaignAnalytics, CampaignSettings, EmailCampaign as Campaign, EmailSystemStatus, Page, SendEvent, SequenceStep } from "../../shared/email";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDateTime } from "../lib/format";
import { useApp } from "../context/AppContext";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, PageHeader, Select, Spinner, StatCard, Tabs, Textarea } from "../components/ui";
import { CampaignStatusBadge, ConfirmDialog, EventBadge, ModeBanner, Pager } from "../components/email/emailUi";
import StepEditor from "../components/email/StepEditor";
import RecipientsPanel from "../components/email/RecipientsPanel";
import TestEmailCard from "../components/email/TestEmailCard";

type Tab = "sequence" | "recipients" | "review" | "activity" | "analytics";
interface Detail {
  campaign: Campaign;
  steps: SequenceStep[];
  readiness: { blocking: string[]; warnings: string[] };
  live_recipients: number;
}

function SettingsCard({ c, onSaved }: { c: Campaign; onSaved: () => void }) {
  const { toast } = useApp();
  const w = c.settings.send_window;
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? "");
  const [windowOn, setWindowOn] = useState(!!w);
  const [start, setStart] = useState(w?.start_hour ?? 9);
  const [end, setEnd] = useState(w?.end_hour ?? 18);
  const [weekdays, setWeekdays] = useState(w?.weekdays_only ?? true);
  const [busy, setBusy] = useState(false);
  const closed = c.status === "completed" || c.status === "cancelled";
  async function save() {
    setBusy(true);
    try {
      const settings: CampaignSettings = { send_window: windowOn ? { start_hour: start, end_hour: end, weekdays_only: weekdays } : null };
      await api.patch(`/email/campaigns/${c.id}`, { name, description, settings });
      toast("Campaign settings saved");
      onSaved();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  const hours = Array.from({ length: 25 }, (_, i) => ({ value: i, label: `${String(i).padStart(2, "0")}:00` }));
  return (
    <Card icon={Settings2} title="Campaign settings">
      <fieldset disabled={closed} className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
        </Field>
        <Field label="What we offer" hint="The AI drafter's only source for our services.">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={windowOn} onChange={(e) => setWindowOn(e.target.checked)} /> Only send within business hours (India Standard Time)
        </label>
        {windowOn && (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From" className="w-28">
              <Select value={start} onChange={(e) => setStart(Number(e.target.value))} options={hours.slice(0, 24)} />
            </Field>
            <Field label="Until" className="w-28">
              <Select value={end} onChange={(e) => setEnd(Number(e.target.value))} options={hours.slice(1)} />
            </Field>
            <label className="flex items-center gap-2 text-sm h-9">
              <input type="checkbox" checked={weekdays} onChange={(e) => setWeekdays(e.target.checked)} /> Weekdays only
            </label>
          </div>
        )}
        <p className="text-xs text-[var(--text-3)]">Sequences stop automatically when the CRM stage becomes {(c.settings.stop_on_crm_statuses ?? ["Converted", "Not Interested", "Lost"]).join(", ")}.</p>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={save} loading={busy}>
            Save settings
          </Button>
        </div>
      </fieldset>
    </Card>
  );
}

function ReviewPanel({ d, status, onChanged }: { d: Detail; status: EmailSystemStatus | null; onChanged: () => void }) {
  const { toast } = useApp();
  const c = d.campaign;
  const approved = c.approved_version != null && c.approved_version === c.content_version;
  const activeSteps = d.steps.filter((s) => s.active);
  const [busy, setBusy] = useState<string | null>(null);
  const [startAt, setStartAt] = useState("");
  const [confirm, setConfirm] = useState(false);
  const recipients = d.live_recipients;
  const can = !!status?.can_approve;

  async function run(key: string, fn: () => Promise<unknown>, msg: string) {
    setBusy(key);
    try {
      await fn();
      toast(msg);
      onChanged();
    } catch (e) {
      const body = (e as { body?: { blocking?: string[]; problems?: string[] } }).body;
      toast([(e as Error).message, ...(body?.blocking ?? []), ...(body?.problems ?? [])].join(" — "), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5 items-start">
      <div className="space-y-5">
        <Card icon={ShieldCheck} title="Readiness" description="Checked again on the server at approval and activation">
          {d.readiness.blocking.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 size={15} /> Ready for approval
            </div>
          ) : (
            <ul className="text-sm space-y-1">
              {d.readiness.blocking.map((b) => (
                <li key={b} className="flex gap-2 text-red-700 dark:text-red-300">
                  <XCircle size={14} className="mt-0.5 shrink-0" /> {b}
                </li>
              ))}
            </ul>
          )}
          {d.readiness.warnings.length > 0 && (
            <ul className="mt-3 text-xs space-y-1 text-amber-800 dark:text-amber-300">
              {d.readiness.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </Card>
        <TestEmailCard campaignId={c.id} steps={activeSteps} status={status} />
      </div>
      <div className="space-y-5">
        <Card icon={CheckCircle2} title="Approval">
          {approved ? (
            <p className="text-sm">
              Approved by <b>{c.approved_by_name}</b> on {formatDateTime(c.approved_at)} (version {c.approved_version}).
            </p>
          ) : (
            <p className="text-sm text-[var(--text-2)]">{c.approved_at === null && c.content_version > 1 ? "Not approved, or changed since the last approval." : "Not approved yet."} An approver must review every step before anything can be sent.</p>
          )}
          {!can && <p className="text-xs text-[var(--text-3)] mt-2">Approving, activating and sending tests needs the role {status?.approver_roles.join(" or ")}.</p>}
          {!approved && !["completed", "cancelled"].includes(c.status) && (
            <div className="flex justify-end mt-3">
              <Button variant="primary" disabled={!can || d.readiness.blocking.length > 0} loading={busy === "approve"} onClick={() => run("approve", () => api.post(`/email/campaigns/${c.id}/approve`), "Sequence approved")}>
                <ShieldCheck size={14} /> Approve sequence
              </Button>
            </div>
          )}
        </Card>
        {c.status === "draft" && (
          <Card icon={Rocket} title="Schedule & activate">
            <Field label="Start" hint="Leave empty to start now. First emails go out at the start time plus the step-1 delay, within the send window.">
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </Field>
            <div className="flex justify-end mt-3">
              <Button variant="primary" disabled={!can || !approved || !recipients} onClick={() => setConfirm(true)}>
                <Rocket size={14} /> {startAt ? "Schedule" : "Activate"} for {recipients ?? "…"} recipients
              </Button>
            </div>
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title={status?.mode === "live" ? "Start sending real emails?" : "Start a dry run?"}
        confirmLabel={startAt ? "Schedule campaign" : "Activate campaign"}
        requireText={String(recipients ?? "")}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          run("activate", () => api.post(`/email/campaigns/${c.id}/activate`, { confirm_recipients: recipients, start_at: startAt ? new Date(startAt).toISOString() : undefined }), startAt ? "Campaign scheduled" : "Campaign activated").then(() =>
            setConfirm(false),
          )
        }
      >
        <p>
          This campaign will {status?.mode === "live" ? <b>send real emails</b> : "simulate sending"} to <b>{recipients}</b> recipient{recipients === 1 ? "" : "s"}, {activeSteps.length} step{activeSteps.length === 1 ? "" : "s"} each, at most {status?.limits.daily_send_limit} emails per day across all campaigns.
        </p>
        <p>Sequences stop for anyone who replies, unsubscribes or bounces. You can pause at any time.</p>
        {status?.mode === "dry_run" && <p className="text-violet-700 dark:text-violet-300">The server is in dry-run mode. This campaign stays a dry run permanently; duplicate it to run it live later.</p>}
      </ConfirmDialog>
    </div>
  );
}

function ActivityPanel({ campaignId }: { campaignId: number }) {
  const [offset, setOffset] = useState(0);
  const { data, error } = useApi<Page<SendEvent>>(`/email/campaigns/${campaignId}/events?limit=100&offset=${offset}`);
  return (
    <Card title="Send log & provider events" description="Attempts, retries, delivery events, bounces, replies and test emails" bodyClassName="px-5 py-3">
      <ErrorNote error={error} />
      {!data ? (
        <Spinner />
      ) : !data.items.length ? (
        <EmptyState compact title="No activity yet" />
      ) : (
        <>
          <ul className="divide-y divide-[var(--border)] text-sm">
            {data.items.map((e) => (
              <li key={e.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-[var(--text-3)] tabular-nums w-28">{formatDateTime(e.occurred_at)}</span>
                <EventBadge type={e.event_type} />
                {e.step_order && <span className="text-xs text-[var(--text-3)]">step {e.step_order}</span>}
                {e.attempt_number && e.attempt_number > 1 && <span className="text-xs text-[var(--text-3)]">attempt {e.attempt_number}</span>}
                <span className="text-xs">{e.email}</span>
                {typeof e.metadata?.error === "string" && <span className="w-full sm:w-auto text-xs text-red-600 dark:text-red-400">{e.metadata.error}</span>}
                {typeof e.metadata?.reason === "string" && <span className="text-xs text-[var(--text-3)]">{e.metadata.reason}</span>}
              </li>
            ))}
          </ul>
          <Pager total={data.total} offset={offset} setOffset={setOffset} size={100} />
        </>
      )}
    </Card>
  );
}

function AnalyticsPanel({ campaignId }: { campaignId: number }) {
  const { data: a, error } = useApi<CampaignAnalytics>(`/email/campaigns/${campaignId}/analytics`);
  if (error) return <ErrorNote error={error} />;
  if (!a) return <Spinner />;
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Recipients" value={a.enrolled} hint={`${a.eligible_live} still in sequence`} />
        <StatCard label="Emails attempted" value={a.messages_attempted} hint="one per recipient × step" />
        <StatCard label="Accepted by provider" value={a.accepted} tone="blue" />
        <StatCard label="Delivered" value={a.delivered} tone="green" hint="from delivery webhooks" />
        <StatCard label="Replies" value={a.replied} tone="violet" hint={`reply rate ${pct(a.reply_rate)}`} />
        <StatCard label="Meetings" value={a.meetings} tone="cyan" hint="Meeting tasks after enrollment" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Hard bounces" value={a.hard_bounced} tone="red" hint={`bounce rate ${pct(a.bounce_rate)}`} />
        <StatCard label="Soft bounces" value={a.soft_bounced} tone="amber" />
        <StatCard label="Unsubscribed" value={a.unsubscribed} tone="red" hint={`rate ${pct(a.unsubscribe_rate)}`} />
        <StatCard label="Failed / unknown" value={`${a.failed} / ${a.ambiguous}`} tone="gray" hint="permanent failures / held for review" />
      </div>
      <Card icon={BarChart3} title="By step" bodyClassName="px-5 py-2">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[var(--text-3)]">
            <tr>
              <th className="py-2 font-medium">Step</th>
              <th className="py-2 font-medium text-right">Accepted</th>
              <th className="py-2 font-medium text-right">Delivered</th>
              <th className="py-2 font-medium text-right">Replied after this step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {a.by_step.map((s) => (
              <tr key={s.step_order}>
                <td className="py-2">Step {s.step_order}</td>
                <td className="py-2 text-right tabular-nums">{s.accepted}</td>
                <td className="py-2 text-right tabular-nums">{s.delivered}</td>
                <td className="py-2 text-right tabular-nums">{s.replied_after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-[var(--text-3)] max-w-3xl">
        Definitions: reply and unsubscribe rates use <i>recipients who were sent at least one email</i> ({a.recipients_contacted}) as the denominator; bounce rate uses <i>emails accepted by the provider</i>. Delivered counts require Brevo delivery
        webhooks. Replies are counted only when detected by the inbound reply webhook or recorded manually. Opens are not reported because mail privacy features make them unreliable. Dry-run sends are counted as accepted.
      </p>
    </div>
  );
}

export default function EmailCampaign() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, invalidate } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) ?? "sequence";
  const { data: d, error, reload } = useApi<Detail>(`/email/campaigns/${id}`);
  const { data: status } = useApi<EmailSystemStatus>("/email/status");
  const [cancelOpen, setCancelOpen] = useState(false);
  const changed = () => {
    reload();
    invalidate();
  };
  async function act(path: string, msg: string, body?: object) {
    try {
      await api.post(path, body);
      toast(msg);
      changed();
    } catch (e) {
      const b = (e as { body?: { problems?: string[] } }).body;
      toast([(e as Error).message, ...(b?.problems ?? [])].join(" — "), "error");
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!d) return <Spinner />;
  const c = d.campaign;
  const editable = c.status === "draft" || c.status === "paused";

  return (
    <>
      <Link to="/email" className="inline-flex items-center gap-1 text-xs text-[var(--text-3)] hover:text-[var(--text)] mb-3">
        <ArrowLeft size={13} /> All campaigns
      </Link>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <CampaignStatusBadge status={c.status} />
            {c.send_mode && <Badge tone={c.send_mode === "live" ? "green" : "purple"}>{c.send_mode === "live" ? "Live" : "Dry run"}</Badge>}
            <span>
              {c.audience} recipients · {c.steps} steps · {c.sent} emails sent · {c.replied} replies
            </span>
            {c.status === "scheduled" && <span>· starts {formatDateTime(c.scheduled_start_at)}</span>}
          </span>
        }
        actions={
          <>
            {(c.status === "active" || c.status === "scheduled") && (
              <Button onClick={() => act(`/email/campaigns/${c.id}/pause`, "Campaign paused — no further emails will be sent until resumed")}>
                <Pause size={14} /> Pause
              </Button>
            )}
            {c.status === "paused" && (
              <Button variant="primary" disabled={!status?.can_approve} title={!status?.can_approve ? "Approvers only" : undefined} onClick={() => act(`/email/campaigns/${c.id}/resume`, "Campaign resumed")}>
                <Play size={14} /> Resume
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  const n = await api.post<Campaign>(`/email/campaigns/${c.id}/duplicate`);
                  toast("Copied as a new draft (steps only, no recipients)");
                  navigate(`/email/${n.id}`);
                } catch (e) {
                  toast((e as Error).message, "error");
                }
              }}
            >
              <Copy size={14} /> Duplicate
            </Button>
            {!["cancelled", "completed"].includes(c.status) && (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Cancel campaign
              </Button>
            )}
          </>
        }
      />
      <ModeBanner status={status} />
      <div className="mb-5">
        <Tabs
          value={tab}
          onChange={(v) => setParams({ tab: v })}
          items={[
            { value: "sequence", label: "Sequence", count: d.steps.length },
            { value: "recipients", label: "Recipients", count: c.audience },
            { value: "review", label: "Review & activate", count: d.readiness.blocking.length || undefined, alert: true },
            { value: "activity", label: "Activity" },
            { value: "analytics", label: "Analytics" },
          ]}
        />
      </div>
      {tab === "sequence" && (
        <div className="grid xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
          <StepEditor campaignId={c.id} steps={d.steps} editable={editable} onChanged={changed} />
          <SettingsCard key={c.updated_at} c={c} onSaved={changed} />
        </div>
      )}
      {tab === "recipients" && <RecipientsPanel campaign={c} steps={d.steps} status={status} onChanged={changed} />}
      {tab === "review" && <ReviewPanel d={d} status={status} onChanged={changed} />}
      {tab === "activity" && <ActivityPanel campaignId={c.id} />}
      {tab === "analytics" && <AnalyticsPanel campaignId={c.id} />}
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this campaign?"
        confirmLabel="Cancel campaign"
        danger
        onClose={() => setCancelOpen(false)}
        onConfirm={async () => {
          await act(`/email/campaigns/${c.id}/cancel`, "Campaign cancelled", { confirm: true });
          setCancelOpen(false);
        }}
      >
        <p>Every recipient's sequence stops permanently and no further emails will be sent. This cannot be undone — use Pause if you may want to continue later.</p>
      </ConfirmDialog>
    </>
  );
}
