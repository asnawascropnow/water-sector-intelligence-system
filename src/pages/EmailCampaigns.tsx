import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Ban, Mail, Plus, Trash2 } from "lucide-react";
import { CAMPAIGN_STATUSES, type EmailCampaign, type EmailSystemStatus, type Page } from "../../shared/email";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDate, formatDateTime } from "../lib/format";
import { useApp } from "../context/AppContext";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, Select, Spinner, Tabs, Textarea } from "../components/ui";
import { CampaignStatusBadge, ConfirmDialog, ModeBanner, Pager } from "../components/email/emailUi";
import RecipientSelector, { enrollSelected, enrollSummary } from "../components/email/RecipientSelector";

const PAGE = 25;

/**
 * Two-step creation: 1) campaign details → creates the draft, 2) choose CRM recipients → enrolls them.
 * Recipients can be skipped here and added later from the campaign's Recipients tab.
 */
function NewCampaignDialog({ open, onClose, status }: { open: boolean; onClose: () => void; status: EmailSystemStatus | null }) {
  const { toast } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [campaign, setCampaign] = useState<EmailCampaign | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function finish(tab: "sequence" | "recipients") {
    const id = campaign?.id;
    setName("");
    setDescription("");
    setCampaign(null);
    setSelected(new Set());
    setError(null);
    onClose();
    if (id) navigate(`/email/${id}?tab=${tab}`);
  }
  // Once the draft exists, closing the dialog opens it instead of discarding the work.
  const close = () => (campaign ? finish("recipients") : onClose());

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCampaign(await api.post<EmailCampaign>("/email/campaigns", { name, description }));
      toast("Draft created — now choose recipients");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function addRecipients() {
    if (!campaign) return;
    setBusy(true);
    setError(null);
    try {
      const r = await enrollSelected(campaign.id, [...selected]);
      toast(enrollSummary(r), r.skipped.length && !r.enrolled ? "error" : "info");
      finish(r.enrolled ? "sequence" : "recipients");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const steps = (
    <ol className="flex items-center gap-2 text-xs mb-4" aria-label="Progress">
      {["Details", "Recipients"].map((label, i) => {
        const current = (campaign ? 1 : 0) === i;
        return (
          <li key={label} className="flex items-center gap-2">
            {i > 0 && <span className="w-6 h-px bg-[var(--border-strong)]" />}
            <span aria-current={current ? "step" : undefined} className={current ? "font-semibold text-[var(--accent-text)]" : "text-[var(--text-3)]"}>
              {i + 1}. {label}
            </span>
          </li>
        );
      })}
    </ol>
  );

  if (!campaign) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="New email campaign"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="new-campaign" loading={busy} disabled={!name.trim()}>
              Create draft & choose recipients
            </Button>
          </>
        }
      >
        {steps}
        <form id="new-campaign" onSubmit={create} className="space-y-4">
          <ErrorNote error={error} />
          <Field label="Campaign name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hospitals — STP audit, Q4" autoFocus maxLength={200} />
          </Field>
          <Field label="What we offer" hint="Used by the AI drafter as the only source for our services. Be specific and factual.">
            <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Water audits and STP performance reviews for hospitals in Bengaluru…" />
          </Field>
          <p className="text-xs text-[var(--text-3)]">Campaigns start as drafts. Nothing is sent until an approver reviews the sequence and activates it.</p>
        </form>
      </Modal>
    );
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title={`Choose recipients — ${campaign.name}`}
      width="max-w-5xl"
      footer={
        <>
          <span className="mr-auto self-center text-sm text-[var(--text-2)]" aria-live="polite">
            <b className="tabular-nums">{selected.size}</b> recipient{selected.size === 1 ? "" : "s"} selected
          </span>
          <Button variant="ghost" onClick={() => finish("sequence")} disabled={busy}>
            Skip for now
          </Button>
          <Button variant="primary" onClick={addRecipients} loading={busy} disabled={!selected.size}>
            Add {selected.size || ""} recipient{selected.size === 1 ? "" : "s"} & continue
          </Button>
        </>
      }
    >
      {steps}
      <ErrorNote error={error} />
      <RecipientSelector campaignId={campaign.id} selected={selected} onChange={setSelected} remaining={status?.limits.max_recipients_per_campaign ?? null} />
    </Modal>
  );
}

function Suppressions() {
  const { toast, invalidate } = useApp();
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const { data, error } = useApi<Page<{ id: number; email: string; reason: string; source: string; created_at: string }>>(`/email/suppressions?limit=${PAGE}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const [email, setEmail] = useState("");
  const [confirm, setConfirm] = useState(false);
  async function add() {
    try {
      const r = await api.post<{ stopped: number }>("/email/suppressions", { email });
      toast(`${email} suppressed${r.stopped ? ` — ${r.stopped} active sequence(s) stopped` : ""}`);
      setEmail("");
      setConfirm(false);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function lift(id: number) {
    try {
      await api.del(`/email/suppressions/${id}`);
      toast("Suppression lifted");
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  return (
    <Card icon={Ban} title="Suppression list" description="Addresses that will never be emailed. Checked on the server immediately before every send.">
      <div className="flex flex-wrap gap-2 mb-4">
        <Input className="!w-64" placeholder="Search address…" value={q} onChange={(e) => (setQ(e.target.value), setOffset(0))} aria-label="Search suppressions" />
        <div className="flex gap-2 ml-auto">
          <Input className="!w-64" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Address to suppress" />
          <Button onClick={() => setConfirm(true)} disabled={!/.+@.+\..+/.test(email)}>
            Suppress address
          </Button>
        </div>
      </div>
      <ErrorNote error={error} />
      {!data ? (
        <Spinner />
      ) : !data.items.length ? (
        <EmptyState compact title="No suppressed addresses" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--text-3)]">
              <tr>
                <th className="py-2 font-medium">Address</th>
                <th className="py-2 font-medium">Reason</th>
                <th className="py-2 font-medium">Source</th>
                <th className="py-2 font-medium">Since</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {data.items.map((s) => (
                <tr key={s.id}>
                  <td className="py-2">{s.email}</td>
                  <td className="py-2">
                    <Badge tone={s.reason === "manual" ? "neutral" : "red"}>{s.reason.replace("_", " ")}</Badge>
                  </td>
                  <td className="py-2 text-[var(--text-3)]">{s.source}</td>
                  <td className="py-2 text-[var(--text-3)]">{formatDate(s.created_at)}</td>
                  <td className="py-2 text-right">
                    {s.reason === "manual" && (
                      <Button size="sm" variant="ghost" onClick={() => lift(s.id)} aria-label={`Lift suppression for ${s.email}`}>
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager total={data.total} offset={offset} setOffset={setOffset} />
        </div>
      )}
      <ConfirmDialog open={confirm} title="Suppress this address?" confirmLabel="Suppress" danger onClose={() => setConfirm(false)} onConfirm={add}>
        <p>
          <b>{email}</b> will never be emailed again by any campaign, and every active sequence for it stops now.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

export default function EmailCampaigns() {
  const [tab, setTab] = useState<"campaigns" | "suppressions">("campaigns");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const { data: sys } = useApi<EmailSystemStatus>("/email/status");
  const { data, error } = useApi<Page<EmailCampaign>>(`/email/campaigns?limit=${PAGE}&offset=${offset}${status ? `&status=${status}` : ""}`);

  return (
    <>
      <PageHeader
        title="Email outreach"
        subtitle="Approval-gated email sequences to CRM prospects. Sequences stop automatically on reply, unsubscribe or bounce."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> New campaign
          </Button>
        }
      />
      <ModeBanner status={sys} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          items={[
            { value: "campaigns", label: "Campaigns", count: data?.total },
            { value: "suppressions", label: "Suppression list" },
          ]}
        />
        {tab === "campaigns" && (
          <Select
            className="!w-44"
            value={status}
            onChange={(e) => (setStatus(e.target.value), setOffset(0))}
            options={CAMPAIGN_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
            placeholder="All statuses"
            aria-label="Filter by status"
          />
        )}
      </div>
      {tab === "suppressions" ? (
        <Suppressions />
      ) : (
        <Card bodyClassName="px-0 py-0">
          <ErrorNote error={error} />
          {!data ? (
            <Spinner />
          ) : !data.items.length ? (
            <EmptyState
              icon={Mail}
              title={status ? `No ${status} campaigns` : "No campaigns yet"}
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={14} /> New campaign
                </Button>
              }
            >
              Create a campaign, add CRM contacts, write a short sequence, then send yourself a test before activating.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="text-left text-xs text-[var(--text-3)] border-b border-[var(--border)]">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Campaign</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Created</th>
                    <th className="px-3 py-2.5 font-medium text-right">Audience</th>
                    <th className="px-3 py-2.5 font-medium text-right">Steps</th>
                    <th className="px-3 py-2.5 font-medium text-right" title="Emails accepted by the provider (or recorded in dry run)">
                      Emails sent
                    </th>
                    <th className="px-3 py-2.5 font-medium text-right">Replies</th>
                    <th className="px-5 py-2.5 font-medium text-right" title="Meeting tasks created for enrolled organizations after enrollment">
                      Meetings
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {data.items.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--surface-2)]">
                      <td className="px-5 py-3">
                        <Link to={`/email/${c.id}`} className="font-medium hover:text-[var(--accent-text)]">
                          {c.name}
                        </Link>
                        <div className="text-xs text-[var(--text-3)]">
                          {c.send_mode === "dry_run" ? "Dry run · " : c.send_mode === "live" ? "Live · " : ""}
                          {c.scheduled_start_at && c.status === "scheduled" ? `Starts ${formatDateTime(c.scheduled_start_at)}` : `Updated ${formatDate(c.updated_at)}`}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <CampaignStatusBadge status={c.status} />
                      </td>
                      <td className="px-3 py-3 text-[var(--text-3)]">{formatDate(c.created_at)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.audience}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.steps}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.sent}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{c.replied}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{c.meetings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-5 pb-3">
                <Pager total={data.total} offset={offset} setOffset={setOffset} />
              </div>
            </div>
          )}
        </Card>
      )}
      <NewCampaignDialog open={creating} onClose={() => setCreating(false)} status={sys} />
    </>
  );
}
