import React from "react";
import { Link } from "react-router-dom";
import type { Task } from "../../shared/types";
import { api } from "../lib/api";
import { dueLabel } from "../lib/format";
import { useApp } from "../context/AppContext";
import { ListChecks } from "lucide-react";
import { Avatar, Badge, cx, EmptyState, priorityTone } from "./ui";

export default function TaskList({ tasks, showOrg = true, emptyText = "No follow-ups", emptyAction }: { tasks: Task[]; showOrg?: boolean; emptyText?: string; emptyAction?: React.ReactNode }) {
  const { invalidate, toast } = useApp();
  if (!tasks.length)
    return (
      <EmptyState title={emptyText} icon={ListChecks} action={emptyAction} compact={!emptyAction}>
        {emptyAction ? "Follow-ups you schedule from the CRM or here will appear in this list." : undefined}
      </EmptyState>
    );

  async function setStatus(t: Task, status: "Done" | "Pending" | "Cancelled") {
    try {
      await api.patch(`/tasks/${t.id}`, { status });
      if (status === "Done") toast(`Completed: ${t.title}`);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <ul className="divide-y divide-[var(--border)]">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-start gap-3 py-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 cursor-pointer accent-[var(--accent)]"
            aria-label={`Mark ${t.title} done`}
            checked={t.status === "Done"}
            disabled={t.status === "Cancelled"}
            onChange={(e) => setStatus(t, e.target.checked ? "Done" : "Pending")}
          />
          <div className="min-w-0 flex-1">
            <div className={cx("text-sm font-medium", t.status !== "Pending" && "line-through text-[var(--text-3)] font-normal")}>{t.title}</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-[var(--text-3)]">
              {showOrg && t.organization_id && (
                <Link to={`/organizations/${t.organization_id}`} className="font-medium text-[var(--accent-text)] hover:underline">
                  {t.organization_name}
                </Link>
              )}
              <span>{t.task_type}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">{t.assigned_name && <Avatar name={t.assigned_name} size={16} />}{t.assigned_name ?? "Unassigned"}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={cx("text-xs tabular-nums", t.overdue ? "text-red-600 dark:text-red-400 font-semibold" : "text-[var(--text-2)]")}>{t.status === "Pending" ? dueLabel(t.due_date) : t.status}</span>
            <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
