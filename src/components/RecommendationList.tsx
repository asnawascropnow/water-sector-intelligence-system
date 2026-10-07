import React, { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Sparkles, X } from "lucide-react";
import type { Recommendation } from "../../shared/types";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import AddToCrmDialog from "./org/AddToCrmDialog";
import { Badge, Button, cx, EmptyState, priorityTone } from "./ui";

const AGENT_LABEL: Record<Recommendation["agent"], string> = {
  next_action: "Next Action Agent",
  opportunity: "Opportunity Agent",
  import_review: "Data Extraction Agent",
  enrichment: "Enrichment Agent",
};
const STRIPE: Record<string, string> = { High: "bg-red-500", Medium: "bg-amber-400", Low: "bg-gray-300 dark:bg-gray-600" };

function targetLink(r: Recommendation) {
  if (r.action_type === "review_import") return `/import?id=${(r.payload as { import_id?: number }).import_id ?? ""}`;
  return r.organization_id ? `/organizations/${r.organization_id}` : null;
}

export default function RecommendationList({ items, compact }: { items: Recommendation[]; compact?: boolean }) {
  const { invalidate, toast } = useApp();
  const [crmOrg, setCrmOrg] = useState<{ id: number; name: string } | null>(null);
  if (!items.length)
    return (
      <EmptyState title="You're all caught up" icon={Sparkles} compact={compact}>
        The agents re-check the CRM every hour and whenever this page loads.
      </EmptyState>
    );

  async function resolve(r: Recommendation, decision: "done" | "dismissed") {
    try {
      await api.post(`/ai/recommendations/${r.id}/${decision}`);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <>
      <ul className={cx(compact ? "-my-3.5 divide-y divide-[var(--border)]" : "space-y-3")}>
        {items.map((r) => {
          const link = targetLink(r);
          return (
            <li
              key={r.id}
              className={cx(
                "relative flex gap-4",
                compact ? "py-3.5 pl-4" : "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 pl-5 hover:border-[var(--border-strong)] transition",
              )}
            >
              <span className={cx("absolute left-0 w-1 rounded-full", compact ? "top-4 bottom-4" : "top-4 bottom-4 left-2", STRIPE[r.priority])} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-sm font-semibold text-[var(--text)]">{r.title}</h3>
                  <Badge tone={priorityTone(r.priority)}>{r.priority}</Badge>
                  {!compact && <Badge tone="purple">{AGENT_LABEL[r.agent]}</Badge>}
                </div>
                <p className={cx("text-[13px] leading-5 text-[var(--text-2)] mt-1", compact && "line-clamp-2")}>{r.reason}</p>
                {!compact && r.assigned_name && <p className="text-xs text-[var(--text-3)] mt-1.5">Assigned to {r.assigned_name}</p>}
              </div>
              <div className={cx("flex shrink-0 gap-1.5", compact ? "items-start" : "items-center self-center")}>
                {!compact && r.action_type === "add_to_crm" && r.organization_id && (
                  <Button size="sm" variant="primary" onClick={() => setCrmOrg({ id: r.organization_id!, name: r.organization_name ?? "" })}>
                    Add to CRM
                  </Button>
                )}
                {link &&
                  (compact ? (
                    <Link to={link} className="inline-flex items-center gap-0.5 text-xs font-medium text-[var(--accent-text)] hover:underline whitespace-nowrap">
                      {r.action_type === "review_import" ? "Review" : "Open"} <ArrowUpRight size={12} />
                    </Link>
                  ) : (
                    <Link to={link}>
                      <Button size="sm">{r.action_type === "review_import" ? "Review" : "Open"}</Button>
                    </Link>
                  ))}
                {!compact && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => resolve(r, "done")} title="Mark done" aria-label="Mark done">
                      <Check size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resolve(r, "dismissed")} title="Dismiss" aria-label="Dismiss">
                      <X size={14} />
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <AddToCrmDialog org={crmOrg} onClose={() => setCrmOrg(null)} />
    </>
  );
}
