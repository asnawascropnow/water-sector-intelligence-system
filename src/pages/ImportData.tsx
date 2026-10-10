import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FileUp } from "lucide-react";
import { ORG_TYPES } from "../../shared/constants";
import type { DuplicateResult, ImportDetail, ImportRecord, ImportSummary, OrganizationInput } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDateTime } from "../lib/format";
import { useApp } from "../context/AppContext";
import { DuplicatePanel } from "../components/org/OrganizationForm";
import { Badge, Button, Card, cx, EmptyState, ErrorNote, Field, Input, Modal, PageHeader, ProvenanceTag, Select, Spinner, Tabs, type Tone } from "../components/ui";

const STATUS_TONE: Record<string, Tone> = { processing: "blue", review: "amber", completed: "green", failed: "red", pending: "neutral", approved: "green", merged: "blue", rejected: "red" };
const LEVEL: Record<string, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "green" },
  existing: { label: "Existing", tone: "blue" },
  possible_duplicate: { label: "Possible duplicate", tone: "amber" },
};

function Uploader({ onUploaded }: { onUploaded: (id: number) => void }) {
  const { toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { id } = await api.upload<{ id: number }>("/imports", fd);
      toast(`Processing ${file.name}…`);
      onUploaded(id);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) upload(f);
      }}
      className={cx("rounded-xl border-2 border-dashed p-8 text-center transition bg-[var(--surface)]", drag ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border-strong)]")}
    >
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-text)]"><FileUp size={22} /></span>
      <p className="mt-2 text-sm font-medium">Drop a file here or choose one</p>
      <p className="text-xs text-[var(--text-3)] mt-1">Excel (.xlsx), CSV, PDF or Word (.docx) · up to 15 MB</p>
      <input ref={input} type="file" accept=".xlsx,.csv,.pdf,.docx" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      <Button className="mt-3" variant="primary" loading={busy} onClick={() => input.current?.click()}>
        Choose file
      </Button>
      <p className="text-[11px] text-[var(--text-3)] mt-3 max-w-md mx-auto">
        Nothing is added to the database until you review it. Spreadsheets need a column for the organization name; other columns (address, phone, email, website, type, sector, pincode, latitude/longitude, contact person) are detected automatically.
      </p>
    </div>
  );
}

function EditRecordDialog({ record, onClose, onSave }: { record: ImportRecord | null; onClose: () => void; onSave: (d: OrganizationInput) => Promise<void> }) {
  const [d, setD] = useState<OrganizationInput | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setD(record ? { ...record.data } : null), [record]);
  if (!record || !d) return null;
  const set = (k: keyof OrganizationInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value || null });
  return (
    <Modal
      open
      onClose={onClose}
      title="Edit imported record"
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await onSave(d).finally(() => setBusy(false));
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Organization name" className="sm:col-span-2">
          <Input value={d.name ?? ""} onChange={set("name")} />
        </Field>
        <Field label="Type">
          <Select value={d.org_type ?? ""} onChange={set("org_type")} options={ORG_TYPES} placeholder="Unknown" />
        </Field>
        <Field label="Sector">
          <Input value={d.sector ?? ""} onChange={set("sector")} />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <Input value={d.address ?? ""} onChange={set("address")} />
        </Field>
        <Field label="Area">
          <Input value={d.area ?? ""} onChange={set("area")} />
        </Field>
        <Field label="Pincode">
          <Input value={d.pincode ?? ""} onChange={set("pincode")} />
        </Field>
        <Field label="Phone">
          <Input value={d.phone ?? ""} onChange={set("phone")} />
        </Field>
        <Field label="Email">
          <Input value={d.email ?? ""} onChange={set("email")} />
        </Field>
        <Field label="Website">
          <Input value={d.website ?? ""} onChange={set("website")} />
        </Field>
        <Field label="Contact person">
          <Input value={d.contact_name ?? ""} onChange={set("contact_name")} />
        </Field>
      </div>
    </Modal>
  );
}

function ImportReview({ id }: { id: number }) {
  const { toast, invalidate } = useApp();
  const { data: imp, error, reload, setData } = useApi<ImportDetail>(`/imports/${id}`);
  const [filter, setFilter] = useState<"all" | "pending" | "new" | "existing" | "possible_duplicate">("pending");
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState<ImportRecord | null>(null);
  const [dupFor, setDupFor] = useState<ImportRecord | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (imp?.status !== "processing") return;
    const t = setInterval(reload, 1500);
    return () => clearInterval(t);
  }, [imp?.status, reload]);

  async function decide(r: ImportRecord, decision: string, body: object = {}) {
    setBusyIdx(r.index);
    try {
      const updated = await api.post<ImportRecord>(`/imports/${id}/records/${r.index}/${decision}`, body);
      setData((d) => (d ? { ...d, records: d.records.map((x) => (x.index === r.index ? updated : x)) } : d));
      setDupFor(null);
      setEditing(null);
      invalidate();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.duplicate) {
        const rec = { ...r, duplicate: e.body.duplicate };
        setData((d) => (d ? { ...d, records: d.records.map((x) => (x.index === r.index ? rec : x)) } : d));
        setDupFor(rec);
      } else toast((e as Error).message, "error");
    } finally {
      setBusyIdx(null);
    }
  }

  if (error) return <ErrorNote error={error} />;
  if (!imp) return <Spinner />;
  const s = imp.stats;
  const rows = imp.records.filter((r) => (filter === "all" ? true : filter === "pending" ? r.status === "pending" : r.duplicate.level === filter));

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {imp.filename} <Badge tone={STATUS_TONE[imp.status]}>{imp.status}</Badge>
        </span>
      }
      actions={
        imp.status === "review" && (
          <Button
            size="sm"
            variant="primary"
            loading={bulkBusy}
            onClick={async () => {
              setBulkBusy(true);
              try {
                const r = await api.post<{ approved: number; held: number }>(`/imports/${id}/approve-new`);
                toast(`Approved ${r.approved} new organization(s)${r.held ? ` · ${r.held} held for duplicate review` : ""}`);
                reload();
                invalidate();
              } catch (e) {
                toast((e as Error).message, "error");
              } finally {
                setBulkBusy(false);
              }
            }}
          >
            Approve all new
          </Button>
        )
      }
    >
      {imp.status === "processing" ? (
        <Spinner label={`Extracting, geocoding and checking duplicates… ${imp.records.length ? `${imp.records.length} records so far` : ""}`} />
      ) : (
        <>
          {imp.error && <div className={cx("text-xs mb-3", imp.status === "failed" ? "text-red-600" : "text-[var(--text-3)]")}>{imp.error}</div>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[
              ["Organizations found", s.found],
              ["New", s.new],
              ["Existing", s.existing],
              ["Possible duplicates", s.possible_duplicates],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3">
                <div className="text-xs text-[var(--text-3)]">{l}</div>
                <div className="text-2xl font-semibold tabular-nums mt-0.5">{v}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <Tabs<typeof filter>
              value={filter}
              onChange={setFilter}
              items={[
                { value: "pending", label: "To review", count: s.pending },
                { value: "all", label: "All", count: s.found },
                { value: "new", label: "New", count: s.new },
                { value: "existing", label: "Existing", count: s.existing },
                { value: "possible_duplicate", label: "Possible duplicates", count: s.possible_duplicates },
              ]}
            />
            <span className="text-xs text-[var(--text-3)]">
              Approved {s.approved} · Merged {s.merged} · Rejected {s.rejected} · Extraction: {imp.extraction_method ?? "—"}
            </span>
          </div>
          {!rows.length ? (
            <EmptyState title={filter === "pending" ? "Everything in this file has been reviewed" : "No records in this view"} />
          ) : (
            <div className="overflow-x-auto -mx-4">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-[var(--text-3)] bg-[var(--surface-2)]">
                  <tr className="border-y border-[var(--border)]">
                    <th className="px-4 py-2.5 font-medium">Organization</th>
                    <th className="px-3 py-2.5 font-medium">Sector / type</th>
                    <th className="px-3 py-2.5 font-medium">Address</th>
                    <th className="px-3 py-2.5 font-medium">Phone / email</th>
                    <th className="px-3 py-2.5 font-medium">Check</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] align-top">
                  {rows.map((r) => (
                    <tr key={r.index}>
                      <td className="px-4 py-2.5 min-w-[220px] max-w-[300px]">
                        <div className="font-medium">{r.data.name}</div>
                        {r.warnings.map((w) => (
                          <div key={w} className="text-[11px] text-amber-700 dark:text-amber-400">
                            {w}
                          </div>
                        ))}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <div>{r.data.sector ?? <span className="text-[var(--text-3)]">Unknown</span>}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          {r.data.org_type} <ProvenanceTag fs={r.field_sources.org_type} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs min-w-[180px] max-w-[260px]">
                        <div>{r.data.address ?? <span className="text-[var(--text-3)]">Unknown</span>}</div>
                        <div className="text-[var(--text-3)] flex items-center gap-1 mt-0.5">
                          {[r.data.area, r.data.pincode].filter(Boolean).join(" · ")}
                          {r.data.lat != null ? <ProvenanceTag fs={r.field_sources.location} /> : <Badge tone="amber">No location</Badge>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                        <div>{r.data.phone ?? <span className="text-[var(--text-3)]">—</span>}</div>
                        <div className="text-[var(--text-3)]">{r.data.email}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={LEVEL[r.duplicate.level].tone}>{LEVEL[r.duplicate.level].label}</Badge>
                        {r.duplicate.candidates[0] && <div className="text-[11px] text-[var(--text-3)] mt-1">≈ {r.duplicate.candidates[0].name}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right min-w-[190px]">
                        {r.status !== "pending" ? (
                          <span className="inline-flex items-center gap-2">
                            <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                            {r.result_org_id && (
                              <Link to={`/organizations/${r.result_org_id}`} className="text-xs text-[var(--accent)] hover:underline">
                                Open
                              </Link>
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex flex-wrap justify-end gap-1">
                            {r.duplicate.level === "new" ? (
                              <Button size="sm" variant="primary" loading={busyIdx === r.index} onClick={() => decide(r, "approve")}>
                                Approve
                              </Button>
                            ) : (
                              <Button size="sm" variant="primary" onClick={() => setDupFor(r)}>
                                Resolve
                              </Button>
                            )}
                            <Button size="sm" onClick={() => setEditing(r)}>
                              Edit
                            </Button>
                            {r.duplicate.level === "new" && r.duplicate.candidates.length === 0 ? null : (
                              <Button size="sm" onClick={() => setDupFor(r)}>
                                Merge
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" disabled={busyIdx === r.index} onClick={() => decide(r, "reject")}>
                              Reject
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <EditRecordDialog record={editing} onClose={() => setEditing(null)} onSave={(d) => decide(editing!, "edit", { data: d })} />
      <Modal open={Boolean(dupFor)} onClose={() => setDupFor(null)} title="Resolve duplicate" width="max-w-2xl">
        {dupFor && (
          <DuplicatePanel
            incoming={dupFor.data}
            duplicate={dupFor.duplicate as DuplicateResult /* project records have no review UI yet (Phase 4: API only) */}
            busy={busyIdx === dupFor.index}
            onMerge={(target) => decide(dupFor, "merge", { merge_into: target })}
            onKeepSeparate={() => decide(dupFor, "keep_separate")}
            onEdit={() => {
              setEditing(dupFor);
              setDupFor(null);
            }}
          />
        )}
      </Modal>
    </Card>
  );
}

export default function ImportData() {
  const [params, setParams] = useSearchParams();
  const selected = Number(params.get("id")) || null;
  const { data: imports, reload } = useApi<ImportSummary[]>("/imports");
  const select = (id: number) => setParams({ id: String(id) });

  useEffect(() => {
    if (!imports?.some((i) => i.status === "processing")) return;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [imports, reload]);

  return (
    <>
      <PageHeader title="Import data" subtitle="Upload files from the field team. Records are extracted, normalised and checked for duplicates, then reviewed before being saved." />
      <div className="grid lg:grid-cols-[340px_1fr] gap-5 items-start">
        <div className="space-y-5">
          <Uploader
            onUploaded={(id) => {
              select(id);
              reload();
            }}
          />
          <Card title="Recent imports" bodyClassName="p-0">
            {!imports ? (
              <Spinner />
            ) : !imports.length ? (
              <EmptyState title="No imports yet" />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {imports.map((i) => (
                  <li key={i.id}>
                    <button onClick={() => select(i.id)} className={cx("w-full text-left px-4 py-2.5 hover:bg-[var(--surface-2)] cursor-pointer", selected === i.id && "bg-[var(--surface-2)]")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium truncate">{i.filename}</span>
                        <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
                      </div>
                      <div className="text-xs text-[var(--text-3)] mt-0.5">
                        {formatDateTime(i.created_at)} · {i.uploaded_by_name ?? "—"} · {i.stats.found} found{i.stats.pending ? ` · ${i.stats.pending} to review` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="min-w-0">
          {selected ? (
            <ImportReview key={selected} id={selected} />
          ) : (
            <Card>
              <EmptyState title="Nothing selected" icon={FileUp}>
                Upload a file, or pick an earlier import on the left to review its records.
              </EmptyState>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
