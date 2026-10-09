import React, { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, MessageSquareReply, Pause, Play, UserMinus, UserPlus } from "lucide-react";
import { ENROLLMENT_STATUSES, type EmailCampaign, type Enrollment, type EmailSystemStatus, type Page, type SendEvent, type SequenceStep } from "../../../shared/email";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { formatDateTime } from "../../lib/format";
import { useApp } from "../../context/AppContext";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Modal, Select, Spinner, Textarea } from "../ui";
import { EnrollmentStatusBadge, EventBadge, Pager } from "./emailUi";
import { AiDraftModal, PreviewModal } from "./StepEditor";
import RecipientSelector, { enrollSelected, enrollSummary } from "./RecipientSelector";

const PAGE = 50;

function ProspectPicker({ campaign, status, onDone }: { campaign: EmailCampaign; status: EmailSystemStatus | null; onDone: () => void }) {
  const { toast } = useApp();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  async function enroll() {
    setBusy(true);
    try {
      const r = await enrollSelected(campaign.id, [...selected]);
      toast(enrollSummary(r), r.skipped.length && !r.enrolled ? "error" : "info");
      setSelected(new Set());
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      icon={UserPlus}
      title="Add prospects from the CRM"
      description="Contacts of organizations in the CRM"
      actions={
        <Button variant="primary" size="sm" disabled={!selected.size} loading={busy} onClick={enroll}>
          Add {selected.size || ""} selected
        </Button>
      }
    >
      <RecipientSelector campaignId={campaign.id} selected={selected} onChange={setSelected} remaining={status ? Math.max(0, status.limits.max_recipients_per_campaign - campaign.audience) : null} />
    </Card>
  );
}

interface EnrollmentDetail {
  enrollment: Enrollment;
  events: SendEvent[];
  messages: { id: number; step_order: number; status: string; send_mode: string; attempts: number; subject: string; last_error: string | null; sent_at: string | null; delivered_at: string | null }[];
  drafts: { id: number; step_id: number; step_order: number; subject: string; text_body: string; source: string; status: string; notes: Record<string, unknown> }[];
}

function DraftEditor({ enrollment, step, existing, canApprove, onChanged }: { enrollment: Enrollment; step: SequenceStep; existing?: EnrollmentDetail["drafts"][number]; canApprove: boolean; onChanged: () => void }) {
  const { toast } = useApp();
  const [subject, setSubject] = useState(existing?.subject ?? step.subject_template);
  const [body, setBody] = useState(existing?.text_body ?? step.text_template);
  const [source, setSource] = useState<"ai" | "manual">((existing?.source as "ai") ?? "manual");
  const [notes, setNotes] = useState<object>(existing?.notes ?? {});
  const [ai, setAi] = useState(false);
  const [preview, setPreview] = useState(false);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  const sent = step.step_order <= enrollment.current_step;
  return (
    <div className="rounded-lg border border-[var(--border)] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          Step {step.step_order} {existing && <Badge tone={existing.status === "approved" ? "green" : existing.status === "rejected" ? "red" : "amber"}>{existing.status.replace("_", " ")}</Badge>} {!existing && <Badge>Uses template</Badge>}
        </div>
        {!sent && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setAi(true)}>
              AI personalize
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(true)}>
              Preview
            </Button>
          </div>
        )}
      </div>
      {sent ? (
        <div className="text-xs text-[var(--text-3)]">Already sent.</div>
      ) : (
        <>
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Personalized subject" />
          <Textarea rows={6} value={body} onChange={(e) => (setBody(e.target.value), setSource("manual"))} aria-label="Personalized body" />
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" onClick={() => act(() => api.put(`/email/enrollments/${enrollment.id}/drafts/${step.id}`, { subject, text_body: body, source, notes }), "Personalized draft saved for review")}>
              Save for review
            </Button>
            {existing && canApprove && existing.status === "pending_review" && (
              <>
                <Button size="sm" variant="danger" onClick={() => act(() => api.post(`/email/enrollments/${enrollment.id}/drafts/${step.id}/reject`), "Draft rejected — the step template will be used")}>
                  Reject
                </Button>
                <Button size="sm" variant="primary" onClick={() => act(() => api.post(`/email/enrollments/${enrollment.id}/drafts/${step.id}/approve`), "Draft approved")}>
                  Approve
                </Button>
              </>
            )}
          </div>
        </>
      )}
      <AiDraftModal
        open={ai}
        onClose={() => setAi(false)}
        campaignId={enrollment.campaign_id}
        stepOrder={step.step_order}
        defaultContact={enrollment.contact_id}
        useLabel="Put into editor"
        onUse={(d) => {
          setSubject(d.subject);
          setBody(d.text_body);
          setSource("ai");
          setNotes({ facts_used: d.facts_used, hypotheses: d.hypotheses, warnings: d.warnings });
        }}
      />
      <PreviewModal open={preview} onClose={() => setPreview(false)} campaignId={enrollment.campaign_id} content={{ subject, text: body }} />
    </div>
  );
}

function EnrollmentDialog({ id, steps, onClose, status }: { id: number | null; steps: SequenceStep[]; onClose: () => void; status: EmailSystemStatus | null }) {
  const { invalidate } = useApp();
  const { data, error, reload } = useApi<EnrollmentDetail>(id ? `/email/enrollments/${id}` : null);
  return (
    <Modal open={!!id} onClose={onClose} title={data ? `${data.enrollment.recipient_name ?? data.enrollment.email}` : "Recipient"} width="max-w-3xl">
      <ErrorNote error={error} />
      {!data ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <EnrollmentStatusBadge status={data.enrollment.status} />
            <span className="text-[var(--text-3)]">{data.enrollment.email}</span>
            {data.enrollment.organization_id && (
              <Link to={`/organizations/${data.enrollment.organization_id}`} className="text-[var(--accent-text)] hover:underline">
                {data.enrollment.organization_name}
              </Link>
            )}
          </div>
          {data.enrollment.last_error && <ErrorNote error={data.enrollment.last_error} />}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-3)] mb-2">Emails</h3>
            {!data.messages.length ? (
              <div className="text-sm text-[var(--text-3)]">Nothing sent yet{data.enrollment.next_send_at ? ` — next send ${formatDateTime(data.enrollment.next_send_at)}` : ""}.</div>
            ) : (
              <ul className="text-sm divide-y divide-[var(--border)]">
                {data.messages.map((m) => (
                  <li key={m.id} className="py-2 flex flex-wrap items-center gap-2">
                    <Badge tone="blue">Step {m.step_order}</Badge>
                    <span className="font-medium">{m.subject}</span>
                    <Badge tone={m.status === "sent" ? "green" : m.status === "ambiguous" ? "amber" : m.status.startsWith("failed") ? "red" : "neutral"}>{m.send_mode === "dry_run" && m.status === "sent" ? "dry run" : m.status.replace("_", " ")}</Badge>
                    {m.delivered_at && <Badge tone="green">delivered</Badge>}
                    <span className="text-xs text-[var(--text-3)] ml-auto">
                      {formatDateTime(m.sent_at)} · {m.attempts} attempt{m.attempts === 1 ? "" : "s"}
                    </span>
                    {m.last_error && <div className="w-full text-xs text-red-600 dark:text-red-400">{m.last_error}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {["pending", "active", "paused"].includes(data.enrollment.status) && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-3)] mb-2">Personalized drafts</h3>
              <p className="text-xs text-[var(--text-3)] mb-2">Optional. An approved draft replaces the step template for this recipient only. A draft awaiting review holds that email until it is approved or rejected.</p>
              <div className="space-y-2">
                {steps
                  .filter((s) => s.active)
                  .map((s) => (
                    <DraftEditor
                      key={`${s.id}-${data.drafts.find((d) => d.step_id === s.id)?.status ?? "none"}`}
                      enrollment={data.enrollment}
                      step={s}
                      existing={data.drafts.find((d) => d.step_id === s.id)}
                      canApprove={!!status?.can_approve}
                      onChanged={() => (reload(), invalidate())}
                    />
                  ))}
              </div>
            </section>
          )}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-3)] mb-2">Events</h3>
            {!data.events.length ? (
              <div className="text-sm text-[var(--text-3)]">No events yet.</div>
            ) : (
              <ul className="text-sm space-y-1.5">
                {data.events.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-[var(--text-3)] w-28 tabular-nums">{formatDateTime(e.occurred_at)}</span>
                    <EventBadge type={e.event_type} />
                    {e.step_order && <span className="text-xs text-[var(--text-3)]">step {e.step_order}</span>}
                    {typeof e.metadata?.error === "string" && <span className="text-xs text-red-600 dark:text-red-400">{e.metadata.error}</span>}
                    {typeof e.metadata?.excerpt === "string" && <div className="w-full ml-28 text-xs text-[var(--text-2)] whitespace-pre-wrap border-l-2 border-[var(--border)] pl-2">{e.metadata.excerpt.slice(0, 600)}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

export default function RecipientsPanel({ campaign, steps, status, onChanged }: { campaign: EmailCampaign; steps: SequenceStep[]; status: EmailSystemStatus | null; onChanged: () => void }) {
  const { toast } = useApp();
  const [filter, setFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<number | null>(null);
  const [ambiguous, setAmbiguous] = useState<Enrollment | null>(null);
  const { data, error } = useApi<Page<Enrollment>>(`/email/campaigns/${campaign.id}/enrollments?limit=${PAGE}&offset=${offset}${filter ? `&status=${filter}` : ""}`);
  const closed = campaign.status === "completed" || campaign.status === "cancelled";

  const act = async (path: string, msg: string, body?: object) => {
    try {
      await api.post(path, body);
      toast(msg);
      onChanged();
    } catch (e) {
      const err = e as Error & { body?: { ambiguous?: boolean } };
      toast(err.message, "error");
    }
  };

  return (
    <div className="space-y-5">
      {!closed && <ProspectPicker campaign={campaign} status={status} onDone={onChanged} />}
      <Card
        title="Recipients"
        description={data ? `${data.total} ${filter || "total"}` : undefined}
        actions={<Select className="!w-40" value={filter} onChange={(e) => (setFilter(e.target.value), setOffset(0))} options={[...ENROLLMENT_STATUSES]} placeholder="All statuses" aria-label="Filter recipients" />}
        bodyClassName="px-0 py-0"
      >
        <ErrorNote error={error} />
        {!data ? (
          <Spinner />
        ) : !data.items.length ? (
          <EmptyState compact title="No recipients yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="text-left text-xs text-[var(--text-3)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-5 py-2 font-medium">Recipient</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Progress</th>
                  <th className="px-3 py-2 font-medium">Next send</th>
                  <th className="px-3 py-2 font-medium">Notes</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2.5">
                      <button className="font-medium hover:text-[var(--accent-text)] cursor-pointer text-left" onClick={() => setOpenId(e.id)}>
                        {e.recipient_name ?? e.email}
                      </button>
                      <div className="text-xs text-[var(--text-3)]">
                        {e.email} · {e.organization_name}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <EnrollmentStatusBadge status={e.status} />
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {e.current_step}/{steps.filter((s) => s.active).length} sent
                      {e.attempt_count > 0 && <div className="text-xs text-amber-600">retry {e.attempt_count}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-xs">{e.status === "active" ? formatDateTime(e.next_send_at) : "—"}</td>
                    <td className="px-3 py-2.5 text-xs max-w-[260px]">
                      {e.pending_drafts > 0 && <Badge tone="amber">{e.pending_drafts} draft to review</Badge>}
                      <div className={e.last_error ? "text-red-600 dark:text-red-400" : "text-[var(--text-3)]"}>{e.last_error ?? e.stop_reason ?? ""}</div>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex justify-end gap-1">
                        {(e.status === "active" || e.status === "pending") && (
                          <Button size="sm" variant="ghost" title="Pause" aria-label="Pause recipient" onClick={() => act(`/email/enrollments/${e.id}/pause`, "Recipient paused")}>
                            <Pause size={13} />
                          </Button>
                        )}
                        {e.status === "paused" && !closed && (
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Resume"
                            aria-label="Resume recipient"
                            onClick={() => (e.ambiguous_message ? setAmbiguous(e) : act(`/email/enrollments/${e.id}/resume`, "Recipient resumed"))}
                          >
                            <Play size={13} />
                          </Button>
                        )}
                        {["pending", "active", "paused"].includes(e.status) && (
                          <>
                            <Button size="sm" variant="ghost" title="Record a reply received elsewhere" aria-label="Mark replied" onClick={() => act(`/email/enrollments/${e.id}/mark-replied`, "Marked as replied — sequence stopped")}>
                              <MessageSquareReply size={13} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Remove from campaign"
                              aria-label="Remove recipient"
                              onClick={() => window.confirm(`Remove ${e.email} from this campaign? No further emails will be sent to them.`) && act(`/email/enrollments/${e.id}/remove`, "Recipient removed")}
                            >
                              <UserMinus size={13} />
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-5 pb-3">
              <Pager total={data.total} offset={offset} setOffset={setOffset} size={PAGE} />
            </div>
          </div>
        )}
      </Card>
      <EnrollmentDialog id={openId} steps={steps} status={status} onClose={() => setOpenId(null)} />
      <Modal
        open={!!ambiguous}
        onClose={() => setAmbiguous(null)}
        title="Was the last email sent?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAmbiguous(null)}>
              Back
            </Button>
            <Button onClick={() => (act(`/email/enrollments/${ambiguous!.id}/resume`, "Will send again", { ambiguous_resolution: "resend" }), setAmbiguous(null))}>Not sent — send again</Button>
            <Button variant="primary" onClick={() => (act(`/email/enrollments/${ambiguous!.id}/resume`, "Marked as sent; sequence continues", { ambiguous_resolution: "mark_sent" }), setAmbiguous(null))}>
              <CheckCircle2 size={14} /> It was sent
            </Button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-2)]">
          The provider did not give a clear answer for the last email to <b>{ambiguous?.email}</b> (for example, a timeout). To avoid sending twice, WSIS held this recipient. Check the email logs in Brevo, then choose. Only approvers can decide.
        </p>
      </Modal>
    </div>
  );
}

