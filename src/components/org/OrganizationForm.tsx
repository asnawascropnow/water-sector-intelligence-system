import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ORG_TYPES } from "../../../shared/constants";
import type { DuplicateResult, Organization, OrganizationInput } from "../../../shared/types";
import { api, ApiError } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Badge, Button, ErrorNote, Field, Input, Modal } from "../ui";

type FormState = Record<keyof OrganizationInput, string>;
const EMPTY: FormState = {
  name: "", org_type: "", sector: "", address: "", area: "", city: "Bengaluru", pincode: "", lat: "", lng: "",
  website: "", phone: "", email: "", contact_name: "", contact_designation: "",
};

function toInput(f: FormState): OrganizationInput {
  const t = (v: string) => v.trim() || null;
  return {
    name: f.name.trim(),
    org_type: (t(f.org_type) as OrganizationInput["org_type"]) ?? null,
    sector: t(f.sector), address: t(f.address), area: t(f.area), city: t(f.city), pincode: t(f.pincode),
    lat: f.lat.trim() ? Number(f.lat) : null, lng: f.lng.trim() ? Number(f.lng) : null,
    website: t(f.website), phone: t(f.phone), email: t(f.email),
    contact_name: t(f.contact_name), contact_designation: t(f.contact_designation),
  };
}

/** Existing vs new comparison with Merge / Keep Separate / Edit (spec §11). */
export function DuplicatePanel({
  incoming,
  duplicate,
  onMerge,
  onKeepSeparate,
  onEdit,
  busy,
}: {
  incoming: OrganizationInput;
  duplicate: DuplicateResult;
  onMerge: (targetId: number) => void;
  onKeepSeparate: () => void;
  onEdit: () => void;
  busy?: boolean;
}) {
  const [target, setTarget] = useState(duplicate.candidates[0]?.id);
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
        {duplicate.level === "existing" ? "This organization already exists." : "Possible duplicate found."} Choose how to handle it.
      </div>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-xs font-medium text-[var(--text-3)] mb-1">Existing</div>
          {duplicate.candidates.length === 0 && <div className="text-[var(--text-3)] text-xs">Matches another record in the same file.</div>}
          <div className="space-y-2">
            {duplicate.candidates.map((c) => (
              <label key={c.id} className="flex gap-2 rounded-md border border-[var(--border)] p-2 cursor-pointer">
                <input type="radio" name="dup-target" checked={target === c.id} onChange={() => setTarget(c.id)} className="mt-1" />
                <div className="min-w-0">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-[var(--text-3)]">{c.address ?? "Address unknown"}</div>
                  <div className="text-xs text-[var(--text-3)]">{[c.phone, c.website].filter(Boolean).join(" · ")}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    <Badge tone="amber">{Math.round(c.score * 100)}% match</Badge>
                    {c.reasons.map((r) => (
                      <Badge key={r}>{r}</Badge>
                    ))}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-medium text-[var(--text-3)] mb-1">New</div>
          <div className="rounded-md border border-[var(--border)] p-2">
            <div className="font-medium">{incoming.name}</div>
            <div className="text-xs text-[var(--text-3)]">{incoming.address ?? "Address unknown"}</div>
            <div className="text-xs text-[var(--text-3)]">{[incoming.phone, incoming.email, incoming.website].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="ghost" onClick={onEdit} disabled={busy}>
          Edit
        </Button>
        <Button onClick={onKeepSeparate} disabled={busy}>
          Keep Separate
        </Button>
        <Button variant="primary" onClick={() => target && onMerge(target)} disabled={busy || !target}>
          Merge
        </Button>
      </div>
      <p className="text-[11px] text-[var(--text-3)]">Merge fills in missing fields on the existing record and never overwrites existing values. Differences are noted in its timeline.</p>
    </div>
  );
}

export default function OrganizationForm({ open, onClose, organization }: { open: boolean; onClose: () => void; organization?: Organization }) {
  const { invalidate, toast, taxonomy } = useApp();
  // Organization types from the database catalog, grouped. Inactive (legacy) types are offered only to
  // keep an organization's current value selectable. Falls back to the MVP list until the catalog loads.
  const typeGroups = taxonomy
    ? taxonomy.groups
        .map((g) => ({ key: g.key, label: g.label, types: taxonomy.types.filter((t) => t.group === g.key && (t.active || t.key === organization?.org_type)).map((t) => t.key) }))
        .filter((g) => g.types.length)
    : [{ key: "mvp", label: "Types", types: [...ORG_TYPES] as string[] }];
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateResult | null>(null);
  const editing = Boolean(organization);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDuplicate(null);
    if (organization) {
      const s = (v: unknown) => (v == null ? "" : String(v));
      setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, s((organization as unknown as Record<string, unknown>)[k])])) } as FormState);
    } else setForm(EMPTY);
  }, [open, organization]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(opts: { force?: boolean; merge_into?: number } = {}) {
    setError(null);
    const data = toInput(form);
    if (!data.name) return setError("Organization name is required");
    if ((data.lat == null) !== (data.lng == null)) return setError("Enter both latitude and longitude, or neither");
    setBusy(true);
    try {
      if (editing) {
        const { contact_name: _c, contact_designation: _d, city: _city, ...patch } = data;
        await api.patch(`/organizations/${organization!.id}`, patch);
        toast("Organization updated");
        invalidate();
        onClose();
      } else {
        const res = await api.post<{ id: number; merged: boolean; warnings: string[] }>("/organizations", { data, ...opts });
        toast(res.merged ? "Merged into the existing organization" : "Organization created");
        invalidate();
        onClose();
        navigate(`/organizations/${res.id}`);
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body?.duplicate) setDuplicate(e.body.duplicate);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${organization!.name}` : "Add organization"}
      width="max-w-2xl"
      footer={
        !duplicate && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => submit()}>
              {editing ? "Save changes" : "Add organization"}
            </Button>
          </>
        )
      }
    >
      {duplicate ? (
        <DuplicatePanel
          incoming={toInput(form)}
          duplicate={duplicate}
          busy={busy}
          onEdit={() => setDuplicate(null)}
          onKeepSeparate={() => submit({ force: true })}
          onMerge={(id) => submit({ merge_into: id })}
        />
      ) : (
        <form
          className="grid sm:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Organization name *" className="sm:col-span-2">
            <Input value={form.name} onChange={set("name")} autoFocus required />
          </Field>
          <Field label="Organization type" hint={!form.org_type ? "Leave blank to infer from the name (labelled AI Inference)" : undefined}>
            <select
              value={form.org_type}
              onChange={set("org_type")}
              aria-label="Organization type"
              className="w-full h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 pr-8 text-sm text-[var(--text)] shadow-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 focus:border-[var(--accent)]"
            >
              <option value="">Unknown</option>
              {typeGroups.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.types.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Sector">
            <Input value={form.sector} onChange={set("sector")} placeholder="e.g. Textile dyeing, Pharma" />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={form.address} onChange={set("address")} />
          </Field>
          <Field label="Area" hint="Detected from the address if left blank">
            <Input value={form.area} onChange={set("area")} placeholder="e.g. Peenya" />
          </Field>
          <Field label="Pincode">
            <Input value={form.pincode} onChange={set("pincode")} inputMode="numeric" maxLength={6} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={set("email")} type="email" />
          </Field>
          <Field label="Website" className="sm:col-span-2">
            <Input value={form.website} onChange={set("website")} placeholder="example.com" />
          </Field>
          <Field label="Latitude" hint="Optional. Use the enrichment agent to geocode from the address.">
            <Input value={form.lat} onChange={set("lat")} inputMode="decimal" placeholder="12.97…" />
          </Field>
          <Field label="Longitude">
            <Input value={form.lng} onChange={set("lng")} inputMode="decimal" placeholder="77.59…" />
          </Field>
          {!editing && (
            <>
              <Field label="Contact person">
                <Input value={form.contact_name} onChange={set("contact_name")} />
              </Field>
              <Field label="Designation">
                <Input value={form.contact_designation} onChange={set("contact_designation")} />
              </Field>
            </>
          )}
          <div className="sm:col-span-2">
            <ErrorNote error={error} />
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
