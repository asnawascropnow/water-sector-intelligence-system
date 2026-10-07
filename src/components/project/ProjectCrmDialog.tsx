import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { POTENTIAL_LEVELS } from "../../../shared/constants";
import type { Opportunity, ProjectStakeholder } from "../../../shared/types";
import { api } from "../../lib/api";
import { boardColumns, findPipeline } from "../../lib/crmUtils";
import { useApp } from "../../context/AppContext";
import { Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "../ui";

/**
 * Create a CRM opportunity in the Project Opportunity pipeline for one of the project's stakeholder
 * organizations. The customer is never chosen silently: with several stakeholders the person picks one; with
 * exactly one it is prefilled but still shown.
 */
export default function ProjectCrmDialog({ projectId, projectName, stakeholders, open, onClose }: { projectId: number; projectName: string; stakeholders: ProjectStakeholder[]; open: boolean; onClose: () => void }) {
  const { catalog, activeUsers, currentUser, invalidate, toast } = useApp();
  const navigate = useNavigate();
  const orgs = [...new Map(stakeholders.map((s) => [s.organization_id, s])).values()];
  const rolesOf = (orgId: number) => stakeholders.filter((s) => s.organization_id === orgId).map((s) => s.role).join(", ");
  const pipeline = findPipeline(catalog?.pipelines, "project");
  const stages = boardColumns(pipeline).main;
  const types = (catalog?.opportunityTypes ?? []).filter((t) => t.default_pipeline === "project").map((t) => t.name);
  const blank = () => ({
    organization_id: orgs.length === 1 ? String(orgs[0].organization_id) : "",
    opportunity_type: types[0] ?? "Project Opportunity",
    status: stages[0]?.name ?? "",
    owner_id: String(currentUser?.id ?? ""),
    potential: "",
    title: "",
    notes: "",
  });
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setF(blank());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const opp = await api.post<Opportunity>("/crm", {
        organization_id: Number(f.organization_id),
        project_id: projectId,
        pipeline: "project",
        opportunity_type: f.opportunity_type,
        status: f.status || undefined,
        owner_id: f.owner_id ? Number(f.owner_id) : null,
        potential: f.potential || null,
        title: f.title.trim() || null,
        notes: f.notes.trim() || null,
      });
      toast("Project opportunity created");
      invalidate();
      onClose();
      navigate(`/crm/${opp.id}`);
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
      title="New project opportunity"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!f.organization_id}>
            Create opportunity
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-[var(--text-2)]">
          Project Opportunity pipeline · linked to <span className="font-medium">{projectName}</span>. The customer organization's own relationship opportunities are not affected.
        </p>
        <Field label="Customer organization *" hint={orgs.length > 1 ? "Choose which stakeholder this opportunity is with." : "Only organizations linked to this project as stakeholders."}>
          <Select
            value={f.organization_id}
            onChange={(e) => setF({ ...f, organization_id: e.target.value })}
            options={orgs.map((s) => ({ value: s.organization_id, label: `${s.organization_name} — ${rolesOf(s.organization_id)}` }))}
            placeholder={orgs.length > 1 ? "Choose the customer…" : undefined}
            aria-label="Customer organization"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Opportunity type">
            <Select value={f.opportunity_type} onChange={(e) => setF({ ...f, opportunity_type: e.target.value })} options={types} aria-label="Opportunity type" />
          </Field>
          <Field label="Starting stage">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={stages.map((s) => s.name)} aria-label="Starting stage" />
          </Field>
          <Field label="Owner">
            <Select value={f.owner_id} onChange={(e) => setF({ ...f, owner_id: e.target.value })} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Unassigned" aria-label="Owner" />
          </Field>
          <Field label="Potential" hint="Your rating of this opportunity">
            <Select value={f.potential} onChange={(e) => setF({ ...f, potential: e.target.value })} options={POTENTIAL_LEVELS} placeholder="Not rated" aria-label="Potential" />
          </Field>
        </div>
        <Field label="Title">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={`e.g. Wastewater reuse — ${projectName}`} />
        </Field>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} />
        </Field>
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
