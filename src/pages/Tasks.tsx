import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Task } from "../../shared/types";
import { useApi } from "../lib/useApi";
import { useApp } from "../context/AppContext";
import TaskList from "../components/TaskList";
import TaskDialog from "../components/org/TaskDialog";
import { Button, Card, cx, ErrorNote, PageHeader, Select, Spinner } from "../components/ui";

const SCOPES = [
  { value: "pending", label: "All open" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "done", label: "Completed" },
];

export default function Tasks() {
  const { activeUsers } = useApp();
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") ?? "pending";
  const [who, setWho] = useState<string>(""); // "" = whole team
  const [creating, setCreating] = useState(false);
  const { data: tasks, error } = useApi<Task[]>(`/tasks?scope=${scope}${who ? `&assigned_to=${who}` : ""}`);
  const { data: overdue } = useApi<Task[]>(`/tasks?scope=overdue${who ? `&assigned_to=${who}` : ""}`);

  return (
    <>
      <PageHeader
        title="Tasks / Follow-ups"
        subtitle="Every follow-up has an organization, an owner, a due date and a priority. Overdue items are flagged automatically."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} /> New follow-up
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            onClick={() => setParams({ scope: s.value })}
            className={cx("rounded-full px-3 py-1 text-sm border cursor-pointer", scope === s.value ? "bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900" : "border-neutral-300 dark:border-neutral-700")}
          >
            {s.label}
            {s.value === "overdue" && overdue && overdue.length > 0 && <span className="ml-1.5 rounded-full bg-red-600 text-white text-[10px] px-1.5">{overdue.length}</span>}
          </button>
        ))}
        <span className="flex-1" />
        <Select className="!w-auto" value={who} onChange={(e) => setWho(e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Everyone" aria-label="Assigned to" />
      </div>
      <ErrorNote error={error} />
      <Card bodyClassName="py-1">{!tasks ? <Spinner /> : <TaskList tasks={tasks} emptyText={scope === "overdue" ? "Nothing overdue" : "No follow-ups here"} />}</Card>
      <TaskDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
