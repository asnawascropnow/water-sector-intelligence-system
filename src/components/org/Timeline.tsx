import React from "react";
import type { Activity } from "../../../shared/types";
import { formatDate } from "../../lib/format";
import { EmptyState } from "../ui";

const DOT: Record<string, string> = {
  org_created: "bg-neutral-400",
  crm_added: "bg-blue-500",
  assigned: "bg-blue-400",
  status_change: "bg-violet-500",
  contact_attempted: "bg-amber-500",
  no_response: "bg-amber-600",
  connected: "bg-emerald-500",
  call_scheduled: "bg-sky-500",
  call_completed: "bg-emerald-600",
  proposal_sent: "bg-indigo-500",
  follow_up_created: "bg-orange-500",
  follow_up_completed: "bg-emerald-500",
  merged: "bg-neutral-500",
  enriched: "bg-purple-500",
  ai_assessed: "bg-purple-400",
};

/** Complete, append-only activity timeline (spec §16). */
export default function Timeline({ activities }: { activities: Activity[] }) {
  if (!activities.length) return <EmptyState title="No activity yet" />;
  return (
    <ol className="relative border-l border-[var(--border)] ml-2 space-y-4">
      {activities.map((a) => (
        <li key={a.id} className="ml-4">
          <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${DOT[a.type] ?? "bg-neutral-300"}`} />
          <div className="flex flex-wrap items-baseline gap-x-2">
            <time className="text-xs font-medium text-[var(--text-3)] tabular-nums w-14 shrink-0">{formatDate(a.occurred_at)}</time>
            <span className="text-sm text-[var(--text)]">{a.summary}</span>
          </div>
          {a.actor_name && !a.summary.includes(a.actor_name) && <div className="text-[11px] text-[var(--text-3)] ml-16">by {a.actor_name}</div>}
        </li>
      ))}
    </ol>
  );
}
