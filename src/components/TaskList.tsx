import React from "react";
import { Link } from "react-router-dom";
import type { Task } from "../../shared/types";
import { api } from "../lib/api";
import { dueLabel } from "../lib/format";
import { useApp } from "../context/AppContext";
import { Badge, cx, EmptyState, priorityTone } from "./ui";

export default function TaskList({ tasks, showOrg = true, emptyText = "No follow-ups" }: { tasks: Task[]; showOrg?: boolean; emptyText?: string }) {
  const { invalidate, toast } = useApp();
  if (!tasks.length) return <EmptyState title={emptyText} />;

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
    <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-start gap-3 py-2.5">
          <input
            type="checkbox"
            className="mt-1 cursor-pointer"
            aria-label={`Mark ${t.title} done`}
            checked={t.status === "Done"}
            disabled={t.status === "Cancelled"}
            onChange={(e) => setStatus(t, e.target.checked ? "Done" : "Pending")}
          />
          <div className="min-w-0 flex-1">
            <div className={cx("text-sm", t.status !== "Pending" && "line-through text-neutral-400")}>{t.title}</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-xs text-neutral-500">
              {showOrg && t.organization_id && (
                <Link to={`/organizations/${t.organization_id}`} className="font-medium text-neutral-700 dark:text-neutral-300 hover:underline">
                  {t.organization_name}
                </Link>
              )}
              <span>{t.task_type}</span>
              <span>· {t.assigned_name ?? "Unassigned"}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={cx("text-xs tabular-nums", t.overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-neutral-500")}>{t.status === "Pending" ? dueLabel(t.due_date) : t.status}</span>
            <Badge tone={priorityTone(t.priority)}>{t.priority}</Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}
