import React, { useState } from "react";
import { INTERACTION_TYPES, TASK_PRIORITIES, TASK_TYPES } from "../../../shared/constants";
import { api } from "../../lib/api";
import { todayLocal } from "../../lib/format";
import { useApp } from "../../context/AppContext";
import { Button, ErrorNote, Field, Input, Select, Textarea } from "../ui";

/** Record a contact attempt / call / proposal / note, optionally with a follow-up (spec §15, §17). */
export default function InteractionForm({ opportunityId, ownerId, onDone }: { opportunityId: number; ownerId: number | null; onDone?: () => void }) {
  const { activeUsers, currentUser, invalidate, toast } = useApp();
  const [type, setType] = useState<string>("contact_attempted");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [withFollowUp, setWithFollowUp] = useState(false);
  const [fu, setFu] = useState({ title: "", due_date: todayLocal(2), task_type: "Follow-up", priority: "Medium", assigned_to: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/crm/${opportunityId}/interactions`, {
        type,
        note: note.trim() || null,
        occurred_at: date === todayLocal() ? null : `${date}T12:00:00+05:30`,
        follow_up: withFollowUp ? { ...fu, assigned_to: fu.assigned_to ? Number(fu.assigned_to) : ownerId ?? currentUser?.id } : null,
      });
      toast("Interaction recorded");
      setNote("");
      setWithFollowUp(false);
      invalidate();
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="What happened">
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              if (e.target.value === "call_scheduled") {
                setWithFollowUp(true);
                setFu((f) => ({ ...f, task_type: "Call" }));
              }
            }}
            options={INTERACTION_TYPES.map((t) => ({ value: t.type, label: t.label }))}
          />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Notes">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who you spoke to, what was discussed…" />
      </Field>
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input type="checkbox" checked={withFollowUp} onChange={(e) => setWithFollowUp(e.target.checked)} />
        {type === "call_scheduled" ? "Add the scheduled call as a task" : "Schedule a follow-up"}
      </label>
      {withFollowUp && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
          <Field label="Task" className="col-span-2">
            <Input value={fu.title} onChange={(e) => setFu({ ...fu, title: e.target.value })} placeholder="e.g. Call Operations Manager" />
          </Field>
          <Field label="Due">
            <Input type="date" value={fu.due_date} onChange={(e) => setFu({ ...fu, due_date: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select value={fu.task_type} onChange={(e) => setFu({ ...fu, task_type: e.target.value })} options={TASK_TYPES} />
          </Field>
          <Field label="Priority">
            <Select value={fu.priority} onChange={(e) => setFu({ ...fu, priority: e.target.value })} options={TASK_PRIORITIES} />
          </Field>
          <Field label="Assigned to">
            <Select value={fu.assigned_to} onChange={(e) => setFu({ ...fu, assigned_to: e.target.value })} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Opportunity owner" />
          </Field>
        </div>
      )}
      <ErrorNote error={error} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={busy}>
          Record
        </Button>
      </div>
    </form>
  );
}
