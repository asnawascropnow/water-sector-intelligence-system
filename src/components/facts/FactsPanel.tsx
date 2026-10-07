import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, History, Pencil, Plus, Trash2 } from "lucide-react";
import type { Fact, FactDefinition } from "../../../shared/types";
import { FACT_PROVENANCE } from "../../../shared/constants";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { formatDate } from "../../lib/format";
import { factHistory, formatFactValue, groupFacts } from "../../lib/projectUtils";
import { useApp } from "../../context/AppContext";
import { Badge, Button, confidenceTone, cx, EmptyState, ErrorNote, Field, Input, Modal, ProvenanceTag, Select, Textarea } from "../ui";

/**
 * Reusable sourced-facts panel (organization intelligence and project water intelligence).
 * Uses the fact API only: add, change (versioned — the old value is retired, never overwritten), withdraw.
 * Shows value, source, provenance, confidence and verification state for every fact. Nothing is inferred.
 */
export default function FactsPanel({
  basePath,
  definitions,
  facts,
  emptyTitle = "No verified intelligence recorded yet.",
  emptyHint,
}: {
  /** e.g. /organizations/12 or /projects/3 — facts live at `${basePath}/facts`. */
  basePath: string;
  definitions: FactDefinition[];
  facts: Fact[];
  emptyTitle?: string;
  emptyHint?: React.ReactNode;
}) {
  const { invalidate, toast } = useApp();
  const [editing, setEditing] = useState<{ fact?: Fact; def?: FactDefinition } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const { data: allFacts } = useApi<Fact[]>(showHistory ? `${basePath}/facts?include_retired=1` : null);
  const groups = useMemo(() => groupFacts(facts, definitions), [facts, definitions]);

  async function withdraw(f: Fact) {
    if (!window.confirm(`Withdraw "${f.label}: ${f.value}"? It stays in the history.`)) return;
    try {
      await api.del(`${basePath}/facts/${f.id}`);
      toast("Fact withdrawn (kept in history)");
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs text-[var(--text-3)]">Sourced facts only. Each value shows where it came from and how sure we are.</p>
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
            <History size={13} /> {showHistory ? "Hide history" : "History"}
          </Button>
          <Button size="sm" onClick={() => setEditing({})} disabled={!definitions.length}>
            <Plus size={13} /> Add fact
          </Button>
        </div>
      </div>

      {!groups.length ? (
        <EmptyState title={emptyTitle} compact>
          {emptyHint}
        </EmptyState>
      ) : (
        <dl className="divide-y divide-[var(--border)]">
          {groups.map(({ def, facts: fs }) => (
            <div key={def.key} className="grid sm:grid-cols-[200px_1fr] gap-x-4 gap-y-1 py-3">
              <dt className="text-sm text-[var(--text-3)]">{def.label}</dt>
              <dd className="space-y-2 min-w-0">
                {fs.map((f) => {
                  const history = showHistory && allFacts ? factHistory(f, allFacts) : [];
                  return (
                    <div key={f.id} className="group">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{formatFactValue(f.value, def)}</span>
                        <ProvenanceTag fs={{ provenance: f.provenance, source: f.source }} />
                        <Badge tone={confidenceTone(f.confidence)}>Confidence: {f.confidence}</Badge>
                        {f.provenance === "Verified" ? (
                          <span className="inline-flex items-center gap-0.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 size={12} /> Verified
                          </span>
                        ) : (
                          <span className="text-[11px] text-amber-700 dark:text-amber-400">Needs verification</span>
                        )}
                        <span className="ml-auto flex gap-0.5 opacity-70 group-hover:opacity-100">
                          <button className="p-1 rounded hover:bg-[var(--surface-2)] cursor-pointer" title="Change" aria-label={`Change ${def.label}`} onClick={() => setEditing({ fact: f, def })}>
                            <Pencil size={13} />
                          </button>
                          <button className="p-1 rounded hover:bg-[var(--surface-2)] cursor-pointer" title="Withdraw" aria-label={`Withdraw ${def.label}`} onClick={() => withdraw(f)}>
                            <Trash2 size={13} />
                          </button>
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--text-3)] break-words">
                        {f.source ? <>Source: {/^https?:/.test(f.source) ? <a className="underline" href={f.source} target="_blank" rel="noreferrer">{f.source}</a> : f.source} · </> : null}
                        {f.created_by_name ? `Recorded by ${f.created_by_name}` : "Recorded"} {formatDate(f.created_at)}
                        {f.note ? ` · ${f.note}` : ""}
                      </div>
                      {history.length > 0 && (
                        <ul className="mt-1.5 ml-3 border-l border-[var(--border)] pl-3 space-y-1">
                          {history.map((h) => (
                            <li key={h.id} className="text-[11px] text-[var(--text-3)]">
                              <span className="line-through">{formatFactValue(h.value, def)}</span> · {h.provenance} · {h.confidence}
                              {h.source ? ` · ${h.source}` : ""} · {formatDate(h.created_at)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <FactDialog basePath={basePath} definitions={definitions} state={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ValueInput({ def, value, onChange }: { def: FactDefinition; value: string; onChange: (v: string) => void }) {
  if (def.value_type === "boolean") return <Select value={value} onChange={(e) => onChange(e.target.value)} options={["Yes", "No"]} placeholder="Choose…" aria-label="Value" />;
  if (def.value_type === "enum" || def.value_type === "level") return <Select value={value} onChange={(e) => onChange(e.target.value)} options={def.allowed_values ?? []} placeholder="Choose…" aria-label="Value" />;
  if (def.value_type === "number") return <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder={def.unit ? `Number (${def.unit})` : "Number"} aria-label="Value" />;
  return <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} aria-label="Value" />;
}

function FactDialog({ basePath, definitions, state, onClose }: { basePath: string; definitions: FactDefinition[]; state: { fact?: Fact; def?: FactDefinition } | null; onClose: () => void }) {
  const { invalidate, toast } = useApp();
  const changing = Boolean(state?.fact);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [provenance, setProvenance] = useState("Unverified");
  const [confidence, setConfidence] = useState("Medium");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setError(null);
    const f = state.fact;
    setKey(state.def?.key ?? f?.fact_key ?? definitions[0]?.key ?? "");
    setValue(f?.value ?? "");
    setProvenance(f?.provenance ?? "Unverified");
    setConfidence(f?.confidence ?? "Medium");
    setSource(f?.source ?? "");
    setNote(f?.note ?? "");
  }, [state, definitions]);

  const def = definitions.find((d) => d.key === key);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { value, provenance, confidence, source: source.trim() || null, note: note.trim() || null };
      if (changing) await api.patch(`${basePath}/facts/${state!.fact!.id}`, body);
      else await api.post(`${basePath}/facts`, { key, ...body });
      toast(changing ? "Fact updated — previous value kept in history" : "Fact recorded");
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
      open={Boolean(state)}
      onClose={onClose}
      title={changing ? `Change ${state?.def?.label ?? "fact"}` : "Add fact"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!key || !value.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!changing && (
          <Field label="Fact">
            <Select value={key} onChange={(e) => { setKey(e.target.value); setValue(""); }} options={definitions.map((d) => ({ value: d.key, label: d.label }))} aria-label="Fact" />
          </Field>
        )}
        {def && (
          <Field label="Value" hint={def.description ?? undefined}>
            <ValueInput def={def} value={value} onChange={setValue} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Provenance" hint="Verified = you confirmed it yourself">
            <Select value={provenance} onChange={(e) => setProvenance(e.target.value)} options={FACT_PROVENANCE} aria-label="Provenance" />
          </Field>
          <Field label="Confidence">
            <Select value={confidence} onChange={(e) => setConfidence(e.target.value)} options={["High", "Medium", "Low", "Unknown"]} aria-label="Confidence" />
          </Field>
        </div>
        <Field label={provenance === "Verified" ? "Source (optional)" : "Source (required)"} hint="Where this came from: a person, document, page number or URL">
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Site visit with facility manager, 3 Oct" />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {changing && <p className={cx("text-[11px] text-[var(--text-3)]")}>The current value is retired and kept in the history; the new value becomes the active one.</p>}
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
