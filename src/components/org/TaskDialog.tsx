import React, { useEffect, useState } from "react";
import { TASK_PRIORITIES, TASK_TYPES } from "../../../shared/constants";
import type { Organization } from "../../../shared/types";
import { api } from "../../lib/api";
import { todayLocal } from "../../lib/format";
import { useApi } from "../../lib/useApi";
import { useApp } from "../../context/AppContext";
import { Button, ErrorNote, Field, Input, Modal, Select } from "../ui";

/**
 * New follow-up. Context, most specific first: an opportunity (organization and project come from it), a
 * project, or an organization (attached to its relationship opportunity, as before).
 */
export default function TaskDialog({
  open,
  onClose,
  organizationId,
  opportunityId,
  projectId,
  contextLabel,
}: {
  open: boolean;
  onClose: () => void;
  organizationId?: number;
  opportunityId?: number;
  projectId?: number;
  /** Shown instead of the organization picker when the context is fixed, e.g. "Project opportunity: STP — Lakeside". */
  contextLabel?: string;
}) {
  const { activeUsers, currentUser, invalidate, toast } = useApp();
  const fixedContext = Boolean(organizationId || opportunityId || projectId);
  const { data: crmOrgs } = useApi<Organization[]>(open && !fixedContext ? "/organizations?crm=in" : null);
  const [f, setF] = useState({ title: "", organization_id: "", due_date: todayLocal(1), task_type: "Follow-up", priority: "Medium", assigned_to: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setF({ title: "", organization_id: organizationId ? String(organizationId) : "", due_date: todayLocal(1), task_type: "Follow-up", priority: "Medium", assigned_to: String(currentUser?.id ?? "") });
      setError(null);
    }
  }, [open, organizationId, currentUser]);

  async function submit() {
    if (!f.title.trim()) return setError("Describe the task");
    setBusy(true);
    try {
      await api.post("/tasks", {
        ...f,
        organization_id: opportunityId ? null : f.organization_id ? Number(f.organization_id) : null,
        opportunity_id: opportunityId ?? null,
        project_id: opportunityId ? null : projectId ?? null,
        assigned_to: f.assigned_to ? Number(f.assigned_to) : null,
      });
      toast("Follow-up created");
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
      title="New follow-up"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Create
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Task *" className="col-span-2">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Call Operations Manager" autoFocus />
        </Field>
        {contextLabel && <p className="col-span-2 text-xs text-[var(--text-2)] rounded-md bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2">{contextLabel}</p>}
        {!fixedContext && (
          <Field label="Organization (CRM)" className="col-span-2">
            <Select value={f.organization_id} onChange={(e) => setF({ ...f, organization_id: e.target.value })} options={(crmOrgs ?? []).map((o) => ({ value: o.id, label: o.name }))} placeholder="None" />
          </Field>
        )}
        <Field label="Due date">
          <Input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} />
        </Field>
        <Field label="Type">
          <Select value={f.task_type} onChange={(e) => setF({ ...f, task_type: e.target.value })} options={TASK_TYPES} />
        </Field>
        <Field label="Priority">
          <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} options={TASK_PRIORITIES} />
        </Field>
        <Field label="Assigned to">
          <Select value={f.assigned_to} onChange={(e) => setF({ ...f, assigned_to: e.target.value })} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} />
        </Field>
      </div>
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
    </Modal>
  );
}
