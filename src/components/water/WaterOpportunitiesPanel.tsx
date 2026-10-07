import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Droplets, History, KanbanSquare, RotateCcw, Search, Sparkles, X } from "lucide-react";
import { WATER_OPPORTUNITY_OUTCOMES } from "../../../shared/constants";
import type { Opportunity, ProjectStakeholder, WaterGenerateResult, WaterOpportunity, WaterOpportunityHistoryEntry } from "../../../shared/types";
import { api, ApiError } from "../../lib/api";
import { formatDate } from "../../lib/format";
import { evidenceLabel, generateSummary, groupWaterOpportunities, OUTCOME_LABEL, WATER_SECTIONS, WATER_STATUS_LABEL, waterActions } from "../../lib/waterUtils";
import { useApp } from "../../context/AppContext";
import { Badge, Button, cx, EmptyState, ErrorNote, Field, Modal, potentialTone, confidenceTone, ProvenanceTag, Select, Spinner, Textarea } from "../ui";

export type WaterTarget = { kind: "project" | "organization"; id: number; name: string };

/**
 * Water opportunities for one project or one organization, in review sections. Facts are evidence;
 * suggestions are hypotheses (AI Inference) until a named person approves them; only approved ones can
 * become CRM opportunities; rejected / closed ones stay visible with their reasons.
 */
export default function WaterOpportunitiesPanel({
  items,
  target,
  stakeholders = [],
  crmOpportunities = [],
}: {
  items: WaterOpportunity[];
  target: WaterTarget;
  /** Project stakeholders — the organizations a project opportunity can be converted for. */
  stakeholders?: ProjectStakeholder[];
  /** Existing CRM opportunities that an approved opportunity could be linked to instead of creating one. */
  crmOpportunities?: Opportunity[];
}) {
  const { invalidate, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupWaterOpportunities(items), [items]);

  async function generate() {
    setBusy(true);
    try {
      const r = await api.post<WaterGenerateResult>("/water-opportunities/generate", target.kind === "project" ? { project_id: target.id } : { organization_id: target.id });
      toast(generateSummary(r));
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
        <p className="text-xs text-[var(--text-2)] max-w-2xl leading-5">
          Suggestions are generated from the {target.kind === "project" ? "project's" : "organization's"} recorded facts, quote the evidence they rest on, and are labelled
          AI Inference. They become trusted opportunities only when a person approves them. Nothing is sent to the CRM automatically.
        </p>
        <Button size="sm" onClick={generate} loading={busy}>
          <Search size={13} /> Find opportunities from facts
        </Button>
      </div>

      {!items.length ? (
        <EmptyState title="No water opportunities yet" icon={Droplets}>
          Record water facts with their sources, then use “Find opportunities from facts”. If the evidence is not enough, no suggestion is made.
        </EmptyState>
      ) : (
        WATER_SECTIONS.map((s) => (
          <Section key={s.key} title={s.title} hint={s.hint} count={groups[s.key].length} muted={s.key === "closed"}>
            {groups[s.key].map((w) => (
              <WaterOpportunityItem key={w.id} w={w} target={target} stakeholders={stakeholders} crmOpportunities={crmOpportunities} />
            ))}
          </Section>
        ))
      )}
    </div>
  );
}

function Section({ title, hint, count, muted, children }: { title: string; hint: string; count: number; muted?: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className={cx("text-sm font-semibold", muted && "text-[var(--text-2)]")}>{title}</h3>
        <span className="text-xs text-[var(--text-3)]">{count}</span>
        <span className="text-[11px] text-[var(--text-3)] hidden sm:inline">· {hint}</span>
      </div>
      {count ? <ul className="space-y-3">{children}</ul> : <p className="text-xs text-[var(--text-3)] rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5">None.</p>}
    </section>
  );
}

type Dialog = null | "approve" | "reject" | "start_review" | "reconsider" | "convert" | "close" | "reopen";

export function WaterOpportunityItem({
  w,
  target,
  stakeholders = [],
  crmOpportunities = [],
  readOnly,
}: {
  w: WaterOpportunity;
  target?: WaterTarget;
  stakeholders?: ProjectStakeholder[];
  crmOpportunities?: Opportunity[];
  readOnly?: boolean;
}) {
  const { activeUsers, invalidate, toast } = useApp();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [showHistory, setShowHistory] = useState(false);
  const actions = readOnly ? [] : waterActions(w.status);
  const st = WATER_STATUS_LABEL[w.status] ?? { label: w.status, tone: "neutral" as const };
  const closed = w.status === "rejected" || w.status === "closed";

  async function assign(owner: string) {
    try {
      await api.patch(`/water-opportunities/${w.id}`, { owner_id: owner ? Number(owner) : null });
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <li className={cx("rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5", closed && "opacity-80")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold">{w.intervention_type}</span>
        <Badge tone={potentialTone(w.potential)} dot>
          {w.potential} potential
        </Badge>
        <Badge tone={st.tone}>
          {st.label}
          {w.status === "closed" && w.outcome ? ` · ${OUTCOME_LABEL[w.outcome] ?? w.outcome}` : ""}
        </Badge>
        <ProvenanceTag fs={{ provenance: w.provenance, source: w.source }} />
        <Badge tone={confidenceTone(w.confidence)} title="How strongly the evidence supports it">
          Confidence: {w.confidence}
        </Badge>
        {w.context_key && <Badge>{w.context_key}</Badge>}
        {!w.evidence_current && (
          <Badge tone="amber" title="The facts this suggestion was based on have changed or been withdrawn">
            <AlertTriangle size={11} /> Evidence changed
          </Badge>
        )}
      </div>

      <p className="text-sm text-[var(--text-2)] mt-1.5 leading-5">
        <span className="text-[var(--text-3)]">Why: </span>
        {w.reason}
      </p>

      {w.evidence_refs?.length ? (
        <div className="mt-2">
          <div className="text-[11px] font-medium text-[var(--text-3)] mb-1">Evidence</div>
          <ul className="flex flex-wrap gap-1.5">
            {w.evidence_refs.map((r, i) => (
              <li key={i} className={cx("inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs", r.superseded && "border-amber-300 dark:border-amber-800")}>
                <span className="text-[var(--text)]">{evidenceLabel(r)}</span>
                <ProvenanceTag fs={{ provenance: r.provenance, source: r.source }} />
                {r.source && <span className="text-[var(--text-3)] truncate max-w-[180px]" title={r.source}>{r.source}</span>}
                {r.superseded && (
                  <span className="text-amber-700 dark:text-amber-400" title="This fact has since been changed or withdrawn; the value shown is what the opportunity was based on">
                    · changed since
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        w.evidence && <p className="text-xs text-[var(--text-3)] mt-1">Evidence: {w.evidence}</p>
      )}

      <p className="text-[11px] text-[var(--text-3)] mt-2">
        {w.origin === "ai" ? "Suggested by the Opportunity Agent water rules" : `Recorded by ${w.created_by_name ?? "a team member"}`} · {formatDate(w.created_at)}
        {w.reviewed_at &&
          ` · ${w.status === "rejected" ? "Rejected" : w.status === "needs_review" ? "Previously rejected" : "Reviewed"} by ${w.reviewer_name ?? "a team member"} ${formatDate(w.reviewed_at)}`}
        {w.review_note && ` — “${w.review_note}”`}
        {w.source && w.origin !== "ai" ? ` · Source: ${w.source}` : ""}
      </p>
      {w.crm_opportunity_id && (
        <p className="text-xs mt-1.5 flex flex-wrap items-center gap-1.5">
          <KanbanSquare size={12} className="text-[var(--text-3)]" />
          <span className="text-[var(--text-3)]">CRM:</span>
          <Link to={`/organizations/${w.crm_organization_id}`} className="font-medium hover:underline">
            {w.crm_organization_name}
          </Link>
          <Badge tone={w.crm_pipeline === "project" ? "blue" : "neutral"}>{w.crm_pipeline === "project" ? "Project Opportunity" : "Relationship"} pipeline</Badge>
          {w.crm_status && <Badge>{w.crm_status}</Badge>}
        </p>
      )}
      {readOnly && w.project_name && target?.kind !== "project" && (
        <p className="text-xs mt-1.5">
          <Link to={`/projects/${w.project_id}?tab=opportunities`} className="text-[var(--accent-text)] hover:underline">
            Review on the project →
          </Link>
        </p>
      )}

      {(actions.length > 0 || !readOnly) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-[var(--border)]">
          {actions.includes("start_review") && (
            <Button size="sm" onClick={() => setDialog("start_review")}>
              Review
            </Button>
          )}
          {actions.includes("approve") && (
            <Button size="sm" variant="primary" onClick={() => setDialog("approve")}>
              <Check size={13} /> Approve
            </Button>
          )}
          {actions.includes("reject") && (
            <Button size="sm" variant="danger" onClick={() => setDialog("reject")}>
              <X size={13} /> Reject
            </Button>
          )}
          {actions.includes("convert") && (
            <Button size="sm" variant="primary" onClick={() => setDialog("convert")}>
              <KanbanSquare size={13} /> Create / link CRM opportunity
            </Button>
          )}
          {actions.includes("close") && (
            <Button size="sm" onClick={() => setDialog("close")}>
              Change status
            </Button>
          )}
          {actions.includes("reconsider") && (
            <Button size="sm" onClick={() => setDialog("reconsider")}>
              <RotateCcw size={13} /> Reconsider
            </Button>
          )}
          {actions.includes("reopen") && (
            <Button size="sm" onClick={() => setDialog("reopen")}>
              <RotateCcw size={13} /> Reopen
            </Button>
          )}
          {actions.includes("assign") && (
            <Select
              className="!w-auto !h-8 text-xs"
              value={w.owner_id ? String(w.owner_id) : ""}
              onChange={(e) => assign(e.target.value)}
              options={activeUsers.map((u) => ({ value: u.id, label: `Owner: ${u.name}` }))}
              placeholder="Unassigned"
              aria-label="Owner"
            />
          )}
          {!actions.includes("assign") && w.owner_name && <span className="text-xs text-[var(--text-3)]">Owner: {w.owner_name}</span>}
          {!readOnly && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
              <History size={13} /> History {showHistory ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </Button>
          )}
        </div>
      )}
      {showHistory && <HistoryList id={w.id} />}

      {(dialog === "approve" || dialog === "reject" || dialog === "start_review" || dialog === "reconsider" || dialog === "reopen") && (
        <DecisionDialog w={w} kind={dialog} onClose={() => setDialog(null)} />
      )}
      {dialog === "close" && <CloseDialog w={w} onClose={() => setDialog(null)} />}
      {dialog === "convert" && target && <ConvertDialog w={w} target={target} stakeholders={stakeholders} crmOpportunities={crmOpportunities} onClose={() => setDialog(null)} />}
    </li>
  );
}

const HISTORY_LABEL: Record<string, string> = {
  suggest: "Suggested by the rules (AI Inference)",
  create: "Recorded",
  refresh: "Refreshed from changed evidence",
  start_review: "Moved to review",
  approve: "Approved",
  reject: "Rejected",
  status: "Status changed",
  update: "Updated",
  convert: "Converted to CRM",
  evidence_no_longer_current: "Evidence no longer supports it",
};

function HistoryList({ id }: { id: number }) {
  const [rows, setRows] = useState<WaterOpportunityHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<{ history: WaterOpportunityHistoryEntry[] }>(`/water-opportunities/${id}`)
      .then((r) => setRows(r.history))
      .catch((e) => setError((e as Error).message));
  }, [id]);
  if (error) return <ErrorNote error={error} />;
  if (!rows) return <Spinner />;
  return (
    <ol className="mt-2 space-y-1 border-l border-[var(--border)] pl-3">
      {rows.map((h) => {
        const c = h.changes as { from?: string; to?: string; note?: string | null; outcome?: string | null };
        return (
          <li key={h.id} className="text-xs text-[var(--text-2)]">
            <span className="font-medium">{HISTORY_LABEL[h.action] ?? h.action}</span>
            {c.from && c.to ? ` (${c.from} → ${c.to})` : ""}
            {c.outcome ? ` · ${OUTCOME_LABEL[c.outcome] ?? c.outcome}` : ""}
            {c.note ? ` — “${c.note}”` : ""}
            <span className="text-[var(--text-3)]">
              {" "}
              · {h.actor_name ?? "Agent"} · {formatDate(h.at)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const DECISION: Record<"approve" | "reject" | "start_review" | "reconsider" | "reopen", { title: string; button: string; noteLabel: string; required: boolean }> = {
  approve: { title: "Approve water opportunity", button: "Approve", noteLabel: "Note (optional) — what confirmed it?", required: false },
  reject: { title: "Reject suggestion", button: "Reject", noteLabel: "Reason (required, kept for the audit trail)", required: true },
  start_review: { title: "Start review", button: "Move to review", noteLabel: "Note (optional)", required: false },
  reconsider: { title: "Reconsider rejected opportunity", button: "Move back to review", noteLabel: "Why reconsider? (optional)", required: false },
  reopen: { title: "Reopen opportunity", button: "Reopen", noteLabel: "Note (optional)", required: false },
};

function DecisionDialog({ w, kind, onClose }: { w: WaterOpportunity; kind: keyof typeof DECISION; onClose: () => void }) {
  const { activeUsers, currentUser, invalidate, toast } = useApp();
  const d = DECISION[kind];
  const [note, setNote] = useState("");
  const [owner, setOwner] = useState(String(w.owner_id ?? currentUser?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (kind === "approve" || kind === "reject") await api.post(`/water-opportunities/${w.id}/review`, { decision: kind, note: note.trim() || null });
      else if (kind === "start_review") await api.post(`/water-opportunities/${w.id}/review`, { decision: "start", note: note.trim() || null, owner_id: owner ? Number(owner) : null });
      else await api.patch(`/water-opportunities/${w.id}`, { status: kind === "reconsider" ? "needs_review" : "approved", note: note.trim() || null });
      toast(kind === "approve" ? `${w.intervention_type} approved` : kind === "reject" ? "Suggestion rejected — kept for the audit trail" : "Updated");
      invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={d.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={kind === "reject" ? "danger" : "primary"} loading={busy} onClick={save} disabled={d.required && !note.trim()}>
            {d.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3">
          <div className="text-sm font-semibold">{w.intervention_type}</div>
          <p className="text-xs text-[var(--text-2)] mt-1 leading-5">{w.reason}</p>
        </div>
        {kind === "approve" && (
          <p className="text-xs text-[var(--text-2)]">
            Approving records you as the reviewer and makes this a trusted opportunity. It stays labelled {w.provenance}; the underlying facts keep their own sources.
          </p>
        )}
        {kind === "start_review" && (
          <Field label="Reviewer / owner">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Unassigned" />
          </Field>
        )}
        <ErrorNote error={error} />
        <Field label={d.noteLabel}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}

function CloseDialog({ w, onClose }: { w: WaterOpportunity; onClose: () => void }) {
  const { invalidate, toast } = useApp();
  const [outcome, setOutcome] = useState<string>("not_pursued");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/water-opportunities/${w.id}`, { status: "closed", outcome, note: note.trim() || null });
      toast(`${w.intervention_type} opportunity closed`);
      invalidate();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Change status"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Close opportunity
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-[var(--text-2)]">Closing keeps the opportunity and its history; it can be reopened later.{w.crm_opportunity_id ? " The linked CRM opportunity is not changed." : ""}</p>
        <ErrorNote error={error} />
        <Field label="Outcome">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} options={WATER_OPPORTUNITY_OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))} />
        </Field>
        <Field label="Note (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </Field>
      </div>
    </Modal>
  );
}

function ConvertDialog({
  w,
  target,
  stakeholders,
  crmOpportunities,
  onClose,
}: {
  w: WaterOpportunity;
  target: WaterTarget;
  stakeholders: ProjectStakeholder[];
  crmOpportunities: Opportunity[];
  onClose: () => void;
}) {
  const { catalog, activeUsers, currentUser, invalidate, toast } = useApp();
  const isProject = Boolean(w.project_id);
  const pipeline = isProject ? "project" : "relationship";
  const types = (catalog?.opportunityTypes ?? []).filter((t) => t.default_pipeline === pipeline);
  const orgs = [...new Map(stakeholders.map((s) => [s.organization_id, s])).values()];
  const linkable = crmOpportunities.filter((o) => o.pipeline === pipeline && (isProject ? o.project_id === w.project_id : !o.project_id && o.organization_id === w.organization_id));
  const roleOf = (orgId: number) => stakeholders.filter((s) => s.organization_id === orgId).map((s) => s.role).join(", ");

  const [mode, setMode] = useState<"create" | "link">("create");
  // Project opportunities: the person chooses the customer explicitly (preselected only when there is a single stakeholder).
  const [orgId, setOrgId] = useState(String(isProject ? (orgs.length === 1 ? orgs[0].organization_id : "") : w.organization_id ?? ""));
  const [type, setType] = useState(isProject ? "Project Opportunity" : "Customer");
  const [owner, setOwner] = useState(String(w.owner_id ?? currentUser?.id ?? ""));
  const [linkId, setLinkId] = useState(String(linkable[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body =
        mode === "link"
          ? { crm_opportunity_id: Number(linkId) }
          : { organization_id: isProject ? Number(orgId) : undefined, opportunity_type: type, owner_id: owner ? Number(owner) : null };
      await api.post(`/water-opportunities/${w.id}/convert`, body);
      toast(mode === "link" ? "Linked to the CRM opportunity" : "CRM opportunity created");
      invalidate();
      onClose();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.body?.opportunity_id) {
        setMode("link");
        setLinkId(String(err.body.opportunity_id));
        setError(`${err.message}. You can link this water opportunity to it instead.`);
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const canSave = mode === "link" ? Boolean(linkId) : isProject ? Boolean(orgId) : true;
  return (
    <Modal
      open
      onClose={onClose}
      title="Convert to CRM opportunity"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!canSave}>
            {mode === "link" ? "Link opportunity" : "Create CRM opportunity"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 text-xs text-[var(--text-2)] leading-5">
          <span className="font-semibold text-[var(--text)]">{w.intervention_type}</span> on {target.name}.{" "}
          {isProject
            ? "Project opportunities go into the Project Opportunity pipeline, with the project linked. Choose the stakeholder organization you will work with — the opportunity is not assumed to apply to every stakeholder."
            : "Organization-level opportunities go into the Organization / Relationship pipeline."}
        </div>
        {linkable.length > 0 && (
          <div className="flex gap-1.5" role="group" aria-label="Create or link">
            <Button size="sm" variant={mode === "create" ? "primary" : "secondary"} onClick={() => setMode("create")}>
              Create new
            </Button>
            <Button size="sm" variant={mode === "link" ? "primary" : "secondary"} onClick={() => setMode("link")}>
              Link existing ({linkable.length})
            </Button>
          </div>
        )}
        <ErrorNote error={error} />
        {mode === "link" ? (
          <Field label="Existing CRM opportunity">
            <Select
              value={linkId}
              onChange={(e) => setLinkId(e.target.value)}
              options={linkable.map((o) => ({ value: o.id, label: `${o.organization_name} · ${o.opportunity_type} · ${o.status}${o.title ? ` · ${o.title}` : ""}` }))}
              placeholder="Choose…"
            />
          </Field>
        ) : (
          <>
            {isProject && (
              <Field label="Stakeholder organization (customer)" hint={orgs.length ? undefined : "Link a stakeholder organization to the project first."}>
                <Select value={orgId} onChange={(e) => setOrgId(e.target.value)} options={orgs.map((s) => ({ value: s.organization_id, label: `${s.organization_name} — ${roleOf(s.organization_id)}` }))} placeholder="Choose…" />
              </Field>
            )}
            <Field label="Opportunity type">
              <Select value={type} onChange={(e) => setType(e.target.value)} options={types.map((t) => t.name)} />
            </Field>
            <Field label="Owner">
              <Select value={owner} onChange={(e) => setOwner(e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Unassigned" />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Organization Details: water opportunities on the organization's projects. They belong to each
 * project — shown with the organization's role there, read-only, with a link to review on the project.
 */
export function ProjectWaterOpportunities({ items }: { items: WaterOpportunity[] }) {
  const byProject = useMemo(() => {
    const m = new Map<number, { name: string; roles: string[]; items: WaterOpportunity[] }>();
    for (const w of items) {
      const g = m.get(w.project_id!) ?? { name: w.project_name ?? "Project", roles: w.organization_roles ?? [], items: [] };
      g.items.push(w);
      m.set(w.project_id!, g);
    }
    return [...m.entries()];
  }, [items]);
  if (!items.length) return <p className="text-xs text-[var(--text-3)] rounded-lg border border-dashed border-[var(--border)] px-3 py-2.5">None on the projects this organization is linked to.</p>;
  return (
    <div className="space-y-4">
      {byProject.map(([pid, g]) => (
        <div key={pid}>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <Link to={`/projects/${pid}?tab=opportunities`} className="text-sm font-medium hover:underline">
              {g.name}
            </Link>
            {g.roles.map((r) => (
              <Badge key={r} tone="purple">
                Role: {r}
              </Badge>
            ))}
            <span className="text-[11px] text-[var(--text-3)]">Belongs to the project — not implied for this organization as a whole</span>
          </div>
          <ul className="space-y-2">
            {g.items.map((w) => (
              <CompactWaterItem key={w.id} w={w} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CompactWaterItem({ w }: { w: WaterOpportunity }) {
  const st = WATER_STATUS_LABEL[w.status];
  return (
    <li className="rounded-md border border-[var(--border)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">{w.intervention_type}</span>
        <Badge tone={potentialTone(w.potential)} dot>
          {w.potential}
        </Badge>
        <Badge tone={st.tone}>{st.label}</Badge>
        <ProvenanceTag fs={{ provenance: w.provenance, source: w.source }} />
        <Badge tone={confidenceTone(w.confidence)}>Confidence: {w.confidence}</Badge>
      </div>
      <p className="text-xs text-[var(--text-2)] mt-1 line-clamp-2">{w.reason}</p>
    </li>
  );
}

export function WaterSummaryBadges({ items }: { items: WaterOpportunity[] }) {
  const g = groupWaterOpportunities(items);
  if (!items.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {g.suggestions.length + g.review.length > 0 && (
        <Badge tone="amber">
          <Sparkles size={11} /> {g.suggestions.length + g.review.length} to review
        </Badge>
      )}
      {g.approved.length > 0 && <Badge tone="green">{g.approved.length} approved</Badge>}
    </span>
  );
}
