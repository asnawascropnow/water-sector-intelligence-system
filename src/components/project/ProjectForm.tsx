import React, { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Project, ProjectDuplicateResult, ProjectInput } from "../../../shared/types";
import { api, ApiError } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "../ui";

type FormState = Record<"name" | "project_type" | "description" | "address" | "area" | "pincode" | "website" | "lifecycle_stage" | "scale" | "built_up_area_sqft" | "building_count" | "unit_count" | "lat" | "lng" | "notes", string>;
const EMPTY: FormState = {
  name: "", project_type: "", description: "", address: "", area: "", pincode: "", website: "", lifecycle_stage: "Unknown", scale: "Unknown",
  built_up_area_sqft: "", building_count: "", unit_count: "", lat: "", lng: "", notes: "",
};

function toInput(f: FormState): ProjectInput {
  const t = (v: string) => v.trim() || null;
  const n = (v: string) => (v.trim() ? Number(v.replace(/,/g, "")) : null);
  return {
    name: f.name.trim(), project_type: t(f.project_type), description: t(f.description), address: t(f.address), area: t(f.area), pincode: t(f.pincode),
    website: t(f.website), lifecycle_stage: (f.lifecycle_stage || "Unknown") as ProjectInput["lifecycle_stage"], scale: (f.scale || "Unknown") as ProjectInput["scale"],
    built_up_area_sqft: n(f.built_up_area_sqft), building_count: n(f.building_count), unit_count: n(f.unit_count), lat: n(f.lat), lng: n(f.lng), notes: t(f.notes),
  };
}

/** Possible duplicate projects returned by the API — inspect, then edit or explicitly keep separate. Never merges. */
export function ProjectDuplicatePanel({ duplicate, onKeepSeparate, onEdit, busy }: { duplicate: ProjectDuplicateResult; onKeepSeparate: () => void; onEdit: () => void; busy?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
        {duplicate.level === "existing" ? "This project looks like one that already exists." : "Possible duplicate project found."} Check the matches before creating a new record.
      </div>
      <ul className="space-y-2">
        {duplicate.candidates.map((c) => (
          <li key={c.id} className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-[var(--text-3)]">
                  {[c.project_type, c.lifecycle_stage !== "Unknown" ? c.lifecycle_stage : null, c.area, c.pincode, c.distance_m != null ? `${c.distance_m} m away` : null].filter(Boolean).join(" · ") || "No details recorded"}
                </div>
              </div>
              <a href={`#/projects/${c.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-[var(--accent-text)] hover:underline shrink-0">
                Inspect <ExternalLink size={11} />
              </a>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <Badge tone="amber">{Math.round(c.score * 100)}% match</Badge>
              {c.separate_part && <Badge tone="blue">Different phase / tower</Badge>}
              {c.reasons.map((r) => (
                <Badge key={r}>{r}</Badge>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onEdit} disabled={busy}>
          Edit details
        </Button>
        <Button variant="primary" onClick={onKeepSeparate} loading={busy}>
          Keep separate — create new project
        </Button>
      </div>
      <p className="text-[11px] text-[var(--text-3)]">Nothing is merged automatically. If this really is the same project, cancel and use the existing record.</p>
    </div>
  );
}

/** Create or edit a project. Uses the projects API validation; duplicates require an explicit "Keep separate". */
export default function ProjectForm({ open, onClose, project }: { open: boolean; onClose: () => void; project?: Project }) {
  const { catalog, invalidate, toast } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<ProjectDuplicateResult | null>(null);
  const editing = Boolean(project);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDuplicate(null);
    if (project) {
      const s = (v: unknown) => (v == null ? "" : String(v));
      setForm(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, s((project as unknown as Record<string, unknown>)[k])])) as FormState);
    } else setForm(EMPTY);
  }, [open, project]);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(force = false) {
    setError(null);
    const data = toInput(form);
    if (!data.name) return setError("Project name is required");
    if ((data.lat == null) !== (data.lng == null)) return setError("Enter both latitude and longitude, or neither");
    setBusy(true);
    try {
      if (editing) {
        await api.patch(`/projects/${project!.id}`, data);
        toast("Project updated");
        invalidate();
        onClose();
      } else {
        const created = await api.post<Project>("/projects", { data, force });
        toast("Project created");
        invalidate();
        onClose();
        navigate(`/projects/${created.id}`);
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
      title={editing ? `Edit ${project!.name}` : "New project"}
      width="max-w-2xl"
      footer={
        !duplicate && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => submit()}>
              {editing ? "Save changes" : "Create project"}
            </Button>
          </>
        )
      }
    >
      {duplicate ? (
        <ProjectDuplicatePanel duplicate={duplicate} busy={busy} onEdit={() => setDuplicate(null)} onKeepSeparate={() => submit(true)} />
      ) : (
        <form
          className="grid sm:grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Project name *" className="sm:col-span-2">
            <Input value={form.name} onChange={set("name")} autoFocus required placeholder="e.g. Brigade Lakeside Phase 1" />
          </Field>
          <Field label="Project type">
            <Select value={form.project_type} onChange={set("project_type")} options={catalog?.projectTypes ?? []} placeholder="Unknown" aria-label="Project type" />
          </Field>
          <Field label="Lifecycle stage" hint="Water interventions are easiest to add during design">
            <Select value={form.lifecycle_stage} onChange={set("lifecycle_stage")} options={catalog?.lifecycleStages ?? ["Unknown"]} aria-label="Lifecycle stage" />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea value={form.description} onChange={set("description")} rows={2} />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={form.address} onChange={set("address")} />
          </Field>
          <Field label="Area" hint="Detected from the address if left blank">
            <Input value={form.area} onChange={set("area")} />
          </Field>
          <Field label="Pincode">
            <Input value={form.pincode} onChange={set("pincode")} inputMode="numeric" maxLength={6} />
          </Field>
          <Field label="Website" className="sm:col-span-2">
            <Input value={form.website} onChange={set("website")} placeholder="example.com" />
          </Field>
          <Field label="Scale">
            <Select value={form.scale} onChange={set("scale")} options={catalog?.projectScales ?? ["Unknown"]} aria-label="Scale" />
          </Field>
          <Field label="Built-up area (sq ft)">
            <Input value={form.built_up_area_sqft} onChange={set("built_up_area_sqft")} inputMode="numeric" />
          </Field>
          <Field label="Buildings">
            <Input value={form.building_count} onChange={set("building_count")} inputMode="numeric" />
          </Field>
          <Field label="Units">
            <Input value={form.unit_count} onChange={set("unit_count")} inputMode="numeric" />
          </Field>
          <Field label="Latitude" hint="Optional. Must be within Bengaluru.">
            <Input value={form.lat} onChange={set("lat")} inputMode="decimal" placeholder="12.97…" />
          </Field>
          <Field label="Longitude">
            <Input value={form.lng} onChange={set("lng")} inputMode="decimal" placeholder="77.59…" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={set("notes")} rows={2} />
          </Field>
          <p className="sm:col-span-2 text-[11px] text-[var(--text-3)]">Leave anything you don't know blank — it stays Unknown. Values you enter are recorded with you as the source.</p>
          <div className="sm:col-span-2">
            <ErrorNote error={error} />
          </div>
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}
