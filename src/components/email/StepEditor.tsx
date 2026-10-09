import React, { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, Save, Sparkles, Trash2 } from "lucide-react";
import { TEMPLATE_VARIABLES, type AiDraft, type EligibleContact, type Page, type RenderedEmail, type SequenceStep } from "../../../shared/email";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useApp } from "../../context/AppContext";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from "../ui";
import { dayNumbers, delayLabel, EmailFrame } from "./emailUi";

type Draft = { subject_template: string; text_template: string; delay_days: number; delay_hours: number; active: boolean };
const toDraft = (s: SequenceStep): Draft => ({
  subject_template: s.subject_template,
  text_template: s.text_template,
  delay_days: Math.floor(s.delay_minutes / 1440),
  delay_hours: Math.floor((s.delay_minutes % 1440) / 60),
  active: s.active,
});
const minutes = (d: Draft) => Math.max(0, Math.round(d.delay_days)) * 1440 + Math.max(0, Math.round(d.delay_hours)) * 60;

/** Contact picker used by previews and AI drafts (enrolled contacts first, else any CRM contact). */
export function SampleContactSelect({ campaignId, value, onChange, label = "Preview as" }: { campaignId: number; value: string; onChange: (v: string) => void; label?: string }) {
  const { data } = useApi<Page<EligibleContact>>(`/email/campaigns/${campaignId}/eligible-contacts?limit=200`);
  return (
    <Field label={label}>
      <Select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Generic (no recipient)"
        options={(data?.items ?? []).filter((c) => c.email).map((c) => ({ value: c.contact_id, label: `${c.name} — ${c.organization_name}` }))}
      />
    </Field>
  );
}

export function PreviewModal({ open, onClose, campaignId, content, stepId }: { open: boolean; onClose: () => void; campaignId: number; content?: { subject: string; text: string }; stepId?: number }) {
  const [contact, setContact] = useState("");
  const [r, setR] = useState<RenderedEmail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"html" | "text">("html");
  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .post<RenderedEmail>(`/email/campaigns/${campaignId}/preview`, { ...(stepId && !content ? { step_id: stepId } : { subject: content?.subject ?? "", text: content?.text ?? "" }), contact_id: contact || undefined })
      .then(setR)
      .catch((e) => setError((e as Error).message));
  }, [open, contact, campaignId, stepId, content?.subject, content?.text]);
  return (
    <Modal open={open} onClose={onClose} title="Preview" width="max-w-3xl">
      <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end mb-4">
        <SampleContactSelect campaignId={campaignId} value={contact} onChange={setContact} />
        <div className="flex gap-1">
          <Button size="sm" variant={view === "html" ? "primary" : "secondary"} onClick={() => setView("html")}>
            HTML
          </Button>
          <Button size="sm" variant={view === "text" ? "primary" : "secondary"} onClick={() => setView("text")}>
            Plain text
          </Button>
        </div>
      </div>
      <ErrorNote error={error} />
      {!r ? (
        <Spinner />
      ) : (
        <>
          <div className="text-sm mb-2">
            <span className="text-[var(--text-3)]">Subject: </span>
            <b>{r.subject || "(empty)"}</b>
          </div>
          {(r.missing.length > 0 || r.placeholders.length > 0) && (
            <div className="mb-3 rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              {r.missing.length > 0 && <div>No value for this recipient: {r.missing.map((m) => `{{${m}}}`).join(", ")} — the email will be held unless you add a fallback, e.g. {`{{${r.missing[0]}|…}}`}.</div>}
              {r.placeholders.length > 0 && <div>Placeholders to fill in before approval: {r.placeholders.map((p) => `[[${p}]]`).join(", ")}</div>}
            </div>
          )}
          {view === "html" ? <EmailFrame html={r.html} /> : <pre className="whitespace-pre-wrap text-sm rounded-lg border border-[var(--border)] p-3 bg-[var(--surface-2)] max-h-[420px] overflow-auto">{r.text}</pre>}
        </>
      )}
    </Modal>
  );
}

export function AiDraftModal({
  open,
  onClose,
  campaignId,
  stepOrder,
  defaultContact,
  onUse,
  useLabel = "Use this draft",
}: {
  open: boolean;
  onClose: () => void;
  campaignId: number;
  stepOrder: number;
  defaultContact?: number | null;
  onUse: (d: AiDraft) => void;
  useLabel?: string;
}) {
  const { system } = useApp();
  const [purpose, setPurpose] = useState(stepOrder === 1 ? "Introduction" : "Value-based follow-up");
  const [contact, setContact] = useState(defaultContact ? String(defaultContact) : "");
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setDraft(await api.post<AiDraft>(`/email/campaigns/${campaignId}/ai-draft`, { step_order: stepOrder, purpose, contact_id: contact || undefined }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`AI draft — step ${stepOrder}`}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button onClick={generate} loading={busy} disabled={!system?.llm && !draft}>
            <Sparkles size={14} /> {draft ? "Regenerate" : "Generate"}
          </Button>
          {draft && (
            <Button
              variant="primary"
              onClick={() => {
                onUse(draft);
                onClose();
              }}
            >
              {useLabel}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {!system?.llm && <ErrorNote error="AI drafting is off — set GEMINI_API_KEY on the server." />}
        <ErrorNote error={error} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Purpose of this email">
            <Select value={purpose} onChange={(e) => setPurpose(e.target.value)} options={["Introduction", "Value-based follow-up", "Final meeting request", "Re-engagement"]} />
          </Field>
          {defaultContact === undefined ? (
            <SampleContactSelect campaignId={campaignId} value={contact} onChange={setContact} label="Personalize for (optional)" />
          ) : (
            <div />
          )}
        </div>
        <p className="text-xs text-[var(--text-3)]">
          The AI only sees facts recorded in WSIS, labelled with their provenance. Without a recipient it writes a reusable template with personalization variables. Drafts are never sent until a person reviews and approves them.
        </p>
        {draft && (
          <div className="space-y-3">
            {draft.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 space-y-0.5">
                {draft.warnings.map((w) => (
                  <div key={w}>⚠ {w}</div>
                ))}
              </div>
            )}
            <div className="rounded-lg border border-[var(--border)] p-3">
              <div className="text-sm font-semibold mb-2">{draft.subject}</div>
              <pre className="whitespace-pre-wrap text-sm font-sans">{draft.text_body}</pre>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div>
                <div className="font-medium mb-1">Known facts used</div>
                {draft.facts_used.length ? draft.facts_used.map((f) => <div key={f} className="text-[var(--text-2)]">• {f}</div>) : <div className="text-[var(--text-3)]">None</div>}
              </div>
              <div>
                <div className="font-medium mb-1">Hypotheses (not facts)</div>
                {draft.hypotheses.length ? draft.hypotheses.map((f) => <div key={f} className="text-[var(--text-2)]">• {f}</div>) : <div className="text-[var(--text-3)]">None</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function VariableChips({ onInsert }: { onInsert: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {TEMPLATE_VARIABLES.map((v) => (
        <button
          key={v.key}
          type="button"
          title={v.label}
          onClick={() => onInsert(v.key === "contact.first_name" ? `{{${v.key}|there}}` : `{{${v.key}}}`)}
          className="rounded-md bg-[var(--surface-2)] border border-[var(--border)] px-1.5 py-0.5 text-[11px] font-mono text-[var(--text-2)] hover:border-[var(--accent)] cursor-pointer"
        >
          {v.key}
        </button>
      ))}
    </div>
  );
}

function StepCard({
  campaignId,
  step,
  index,
  count,
  editable,
  day,
  onChanged,
  onMove,
}: {
  campaignId: number;
  step: SequenceStep;
  index: number;
  count: number;
  editable: boolean;
  day: number;
  onChanged: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const { toast } = useApp();
  const [d, setD] = useState<Draft>(toDraft(step));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [ai, setAi] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Reset only when this step changed on the server, so saving another step keeps unsaved edits here.
  useEffect(() => setD(toDraft(step)), [step.id, step.updated_at, step.step_order]);
  const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(step));

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/email/campaigns/${campaignId}/steps/${step.id}`, { subject_template: d.subject_template, text_template: d.text_template, delay_minutes: minutes(d), active: d.active });
      toast(`Step ${step.step_order} saved — the campaign needs approval again`);
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete step ${step.step_order}?`)) return;
    try {
      await api.del(`/email/campaigns/${campaignId}/steps/${step.id}`);
      toast("Step deleted");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  function insert(v: string) {
    const el = bodyRef.current;
    if (!el) return setD({ ...d, text_template: d.text_template + v });
    const s = el.selectionStart ?? d.text_template.length;
    setD({ ...d, text_template: d.text_template.slice(0, s) + v + d.text_template.slice(el.selectionEnd ?? s) });
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Step {step.step_order} <Badge tone="blue">Day {day}</Badge> {!d.active && <Badge>Inactive</Badge>}
        </span>
      }
      description={delayLabel(minutes(d), index === 0)}
      actions={
        <>
          {editable && (
            <>
              <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move step up">
                <ArrowUp size={13} />
              </Button>
              <Button size="sm" variant="ghost" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move step down">
                <ArrowDown size={13} />
              </Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => setPreview(true)}>
            <Eye size={13} /> Preview
          </Button>
        </>
      }
    >
      <fieldset disabled={!editable} className="space-y-3">
        <Field label="Subject">
          <Input value={d.subject_template} onChange={(e) => setD({ ...d, subject_template: e.target.value })} maxLength={300} />
        </Field>
        <Field label="Email body (plain text)" hint="A sender footer with your postal address and an unsubscribe link is added automatically. Use [[…]] for details a person must fill in.">
          <Textarea ref={bodyRef} rows={9} value={d.text_template} onChange={(e) => setD({ ...d, text_template: e.target.value })} className="font-[inherit]" />
        </Field>
        {editable && <VariableChips onInsert={insert} />}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Wait (days)" className="w-28">
            <Input type="number" min={0} max={365} value={d.delay_days} onChange={(e) => setD({ ...d, delay_days: Number(e.target.value) })} />
          </Field>
          <Field label="+ hours" className="w-24">
            <Input type="number" min={0} max={23} value={d.delay_hours} onChange={(e) => setD({ ...d, delay_hours: Number(e.target.value) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm h-9">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} /> Active
          </label>
          {editable && (
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAi(true)}>
                <Sparkles size={13} /> AI draft
              </Button>
              <Button size="sm" variant="danger" onClick={remove}>
                <Trash2 size={13} />
              </Button>
              <Button size="sm" variant="primary" onClick={save} loading={busy} disabled={!dirty || !d.subject_template.trim() || !d.text_template.trim()}>
                <Save size={13} /> Save
              </Button>
            </div>
          )}
        </div>
      </fieldset>
      <PreviewModal open={preview} onClose={() => setPreview(false)} campaignId={campaignId} content={{ subject: d.subject_template, text: d.text_template }} />
      <AiDraftModal open={ai} onClose={() => setAi(false)} campaignId={campaignId} stepOrder={step.step_order} onUse={(x) => setD({ ...d, subject_template: x.subject, text_template: x.text_body })} useLabel="Put into editor" />
    </Card>
  );
}

const STARTER = [
  { subject_template: "{{organization.name}} — water efficiency in {{organization.area|Bengaluru}}", text_template: "Hi {{contact.first_name|there}},\n\n[[One sentence on why you are writing to this organization]]\n\n[[What we offer, in one or two sentences]]\n\nWould a short call next week be useful?\n\n{{sender.name}}", delay_minutes: 0 },
  { subject_template: "Following up — {{organization.name}}", text_template: "Hi {{contact.first_name|there}},\n\n[[A relevant, factual example or insight]]\n\nHappy to share more if helpful.\n\n{{sender.name}}", delay_minutes: 3 * 1440 },
  { subject_template: "15 minutes this month?", text_template: "Hi {{contact.first_name|there}},\n\nI'll keep this short — would a 15-minute call this month make sense? If this isn't relevant, just let me know and I won't follow up again.\n\n{{sender.name}}", delay_minutes: 4 * 1440 },
];

export default function StepEditor({ campaignId, steps, editable, onChanged }: { campaignId: number; steps: SequenceStep[]; editable: boolean; onChanged: () => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const days = dayNumbers(steps.map((s) => (s.active ? s.delay_minutes : 0)));
  async function add(starter = false) {
    setBusy(true);
    try {
      if (starter) for (const s of STARTER) await api.post(`/email/campaigns/${campaignId}/steps`, s);
      else await api.post(`/email/campaigns/${campaignId}/steps`, { subject_template: "Following up", text_template: "Hi {{contact.first_name|there}},\n\n[[Your message]]\n\n{{sender.name}}", delay_minutes: 3 * 1440 });
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  async function move(i: number, dir: -1 | 1) {
    const ids = steps.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    try {
      await api.post(`/email/campaigns/${campaignId}/steps/reorder`, { step_ids: ids });
      onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  return (
    <div className="space-y-4">
      {!editable && <div className="text-xs text-[var(--text-3)]">Pause the campaign to edit the sequence. Any edit requires approval again before sending resumes.</div>}
      {!steps.length && (
        <Card>
          <div className="text-sm text-[var(--text-2)] mb-3">No steps yet. Start from a three-step outline (Day 1 introduction, Day 4 follow-up, Day 8 meeting request) and edit it, or add a blank step.</div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => add(true)} loading={busy} disabled={!editable}>
              Use 3-step outline
            </Button>
            <Button onClick={() => add(false)} disabled={!editable || busy}>
              Add blank step
            </Button>
          </div>
        </Card>
      )}
      {steps.map((s, i) => (
        <StepCard key={s.id} campaignId={campaignId} step={s} index={i} count={steps.length} editable={editable} day={days[i]} onChanged={onChanged} onMove={(dir) => move(i, dir)} />
      ))}
      {steps.length > 0 && editable && (
        <Button onClick={() => add(false)} loading={busy}>
          Add step
        </Button>
      )}
    </div>
  );
}
