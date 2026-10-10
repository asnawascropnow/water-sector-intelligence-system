import React, { useEffect, useState } from "react";
import type { Organization, ProjectStakeholder } from "../../../shared/types";
import { FACT_PROVENANCE } from "../../../shared/constants";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useApp } from "../../context/AppContext";
import { Button, cx, ErrorNote, Field, Input, Modal, Select, Textarea } from "../ui";

/** Search organizations on the server (no full list load). */
function OrganizationPicker({ value, onChange }: { value: Organization | null; onChange: (o: Organization | null) => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const { data, loading } = useApi<Organization[]>(debounced.length >= 2 ? `/organizations?q=${encodeURIComponent(debounced)}` : null);
  if (value)
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-strong)] px-3 h-9 text-sm">
        <span className="truncate">
          {value.name} <span className="text-[var(--text-3)]">· {value.org_type}</span>
        </span>
        <button type="button" className="text-xs text-[var(--accent-text)] hover:underline cursor-pointer" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 2 letters of the organization name…" autoFocus aria-label="Search organizations" />
      {debounced.length >= 2 && (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
          {loading && <li className="px-3 py-2 text-xs text-[var(--text-3)]">Searching…</li>}
          {!loading && !data?.length && <li className="px-3 py-2 text-xs text-[var(--text-3)]">No organization found. Add it on the Organizations page first.</li>}
          {data?.slice(0, 20).map((o) => (
            <li key={o.id}>
              <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--surface-2)] cursor-pointer" onClick={() => onChange(o)}>
                {o.name} <span className="text-xs text-[var(--text-3)]">· {o.org_type}{o.area ? ` · ${o.area}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Add an organization to a project, or edit an existing stakeholder link. */
export default function StakeholderDialog({ projectId, link, open, onClose }: { projectId: number; link?: ProjectStakeholder | null; open: boolean; onClose: () => void }) {
  const { catalog, invalidate, toast } = useApp();
  const editing = Boolean(link);
  const [org, setOrg] = useState<Organization | null>(null);
  const [f, setF] = useState({ role: "", is_primary: false, provenance: "Unverified", confidence: "Unknown", source: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOrg(null);
    setF(
      link
        ? { role: link.role, is_primary: link.is_primary, provenance: link.provenance, confidence: link.confidence, source: link.source ?? "", notes: link.notes ?? "" }
        : { role: catalog?.stakeholderRoles[0] ?? "Developer", is_primary: false, provenance: "Unverified", confidence: "Unknown", source: "", notes: "" },
    );
  }, [open, link, catalog]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body = { role: f.role, is_primary: f.is_primary, provenance: f.provenance, confidence: f.confidence, source: f.source.trim() || null, notes: f.notes.trim() || null };
      if (editing) await api.patch(`/projects/${projectId}/stakeholders/${link!.id}`, body);
      else {
        if (!org) throw new Error("Choose an organization");
        await api.post(`/projects/${projectId}/stakeholders`, { organization_id: org.id, ...body });
      }
      toast(editing ? "Stakeholder updated" : `${org?.name} added as ${f.role}`);
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
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${link!.organization_name}` : "Add stakeholder"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!editing && !org}>
            {editing ? "Save" : "Add to project"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {!editing && (
          <Field label="Organization">
            <OrganizationPicker value={org} onChange={setOrg} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={catalog?.stakeholderRoles ?? []} aria-label="Role" />
          </Field>
          <label className={cx("flex items-center gap-2 text-sm mt-6 cursor-pointer")}>
            <input type="checkbox" checked={f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} className="accent-[var(--accent)]" />
            Primary {f.role ? f.role.toLowerCase() : "stakeholder"} on this project
          </label>
          <Field label="Provenance">
            <Select value={f.provenance} onChange={(e) => setF({ ...f, provenance: e.target.value })} options={FACT_PROVENANCE} aria-label="Provenance" />
          </Field>
          <Field label="Confidence">
            <Select value={f.confidence} onChange={(e) => setF({ ...f, confidence: e.target.value })} options={["High", "Medium", "Low", "Unknown"]} aria-label="Confidence" />
          </Field>
        </div>
        <Field label={f.provenance === "Verified" ? "Source (optional)" : "Source (required)"} hint="e.g. project brochure, RERA page, site board, conversation">
          <Input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} />
        </Field>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} />
        </Field>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
