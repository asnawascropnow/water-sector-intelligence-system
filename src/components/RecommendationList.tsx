import React, { useState } from "react";
import { Link } from "react-router-dom";
import type { Recommendation } from "../../shared/types";
import { api } from "../lib/api";
import { useApp } from "../context/AppContext";
import AddToCrmDialog from "./org/AddToCrmDialog";
import { Badge, Button, EmptyState, priorityTone } from "./ui";

const AGENT_LABEL: Record<Recommendation["agent"], string> = {
  next_action: "Next Action Agent",
  opportunity: "Opportunity Agent",
  import_review: "Data Extraction Agent",
  enrichment: "Enrichment Agent",
};

export default function RecommendationList({ items, compact }: { items: Recommendation[]; compact?: boolean }) {
  const { invalidate, toast } = useApp();
  const [crmOrg, setCrmOrg] = useState<{ id: number; name: string } | null>(null);
  if (!items.length) return <EmptyState title="Nothing to recommend right now">The agents re-check the CRM every hour and whenever this page loads.</EmptyState>;

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
      <ol className="space-y-3">
        {items.map((r, i) => (
          <li key={r.id} className="flex gap-3">
            <span className="text-sm font-semibold text-neutral-400 tabular-nums w-5 shrink-0 text-right">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{r.title}</span>
                <Badge tone={priorityTone(r.priority)}>{r.priority}</Badge>
              </div>
              <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-0.5">
                <span className="font-medium text-neutral-500">Why: </span>
                {r.reason}
              </p>
              {!compact && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Badge tone="purple">{AGENT_LABEL[r.agent]}</Badge>
                  {r.assigned_name && <span className="text-xs text-neutral-500">Assigned to {r.assigned_name}</span>}
                  <span className="flex-1" />
                  {r.action_type === "add_to_crm" && r.organization_id && (
                    <Button size="sm" variant="primary" onClick={() => setCrmOrg({ id: r.organization_id!, name: r.organization_name ?? "" })}>
                      Add to CRM
                    </Button>
                  )}
                  {r.action_type === "review_import" ? (
                    <Link to={`/import?id=${(r.payload as { import_id?: number }).import_id ?? ""}`}>
                      <Button size="sm">Review</Button>
                    </Link>
                  ) : (
                    r.organization_id && (
                      <Link to={`/organizations/${r.organization_id}`}>
                        <Button size="sm">Open</Button>
                      </Link>
                    )
                  )}
                  <Button size="sm" variant="ghost" onClick={() => resolve(r, "done")}>
                    Mark done
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => resolve(r, "dismissed")}>
                    Dismiss
                  </Button>
                </div>
              )}
            </div>
            {compact && r.organization_id && (
              <Link to={`/organizations/${r.organization_id}`} className="text-xs text-[var(--accent)] hover:underline shrink-0 mt-0.5">
                Open
              </Link>
            )}
          </li>
        ))}
      </ol>
      <AddToCrmDialog org={crmOrg} onClose={() => setCrmOrg(null)} />
    </>
  );
}
