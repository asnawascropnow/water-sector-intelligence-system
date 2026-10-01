import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import type { Task } from "../../shared/types";
import { useApi } from "../lib/useApi";
import { useApp } from "../context/AppContext";
import TaskList from "../components/TaskList";
import TaskDialog from "../components/org/TaskDialog";
import { Button, Card, ErrorNote, PageHeader, Select, Spinner, Tabs } from "../components/ui";

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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Tabs
          value={scope}
          onChange={(v) => setParams({ scope: v })}
          items={SCOPES.map((x) => ({ ...x, count: x.value === "overdue" ? overdue?.length ?? 0 : undefined, alert: x.value === "overdue" }))}
        />
        <Select className="!w-48" value={who} onChange={(e) => setWho(e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Everyone" aria-label="Assigned to" />
      </div>
      <ErrorNote error={error} />
      <Card bodyClassName="px-5 py-2">
        {!tasks ? (
          <Spinner />
        ) : (
          <TaskList
            tasks={tasks}
            emptyText={scope === "overdue" ? "Nothing overdue" : "No follow-ups here"}
            emptyAction={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> New follow-up
              </Button>
            }
          />
        )}
      </Card>
      <TaskDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
