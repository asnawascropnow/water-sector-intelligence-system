import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { CLOSED_STATUSES, OUTCOME_STAGES, PIPELINE_STAGES } from "../../shared/constants";
import type { DailyBrief, DashboardSummary, Organization } from "../../shared/types";
import { useApi } from "../lib/useApi";
import { useApp } from "../context/AppContext";
import BengaluruMap from "../components/map/BengaluruMap";
import RecommendationList from "../components/RecommendationList";
import { Card, ErrorNote, PageHeader, Spinner, StatCard } from "../components/ui";

export function TodaysActions({ brief }: { brief: DailyBrief }) {
  const c = brief.counts;
  const items: [number, string, string, string][] = [
    [c.overdueFollowUps, "overdue follow-up", "overdue follow-ups", "/tasks?scope=overdue"],
    [c.followUpsDue, "follow-up due today", "follow-ups due today", "/tasks?scope=today"],
    [c.callsToday, "call today", "calls today", "/tasks?scope=today"],
    [c.proposalsAwaitingResponse, "proposal awaiting response", "proposals awaiting response", "/crm"],
    [c.newOpportunities, "new opportunity", "new opportunities", "/crm"],
    [c.unassignedOpportunities, "unassigned opportunity", "unassigned opportunities", "/crm"],
    [c.pendingImportRecords, "imported record to review", "imported records to review", "/import"],
  ];
  return (
    <ul className="space-y-1.5">
      {items.map(([n, one, many, to], i) => (
        <li key={one}>
          <Link to={to} className="flex items-baseline gap-2 text-sm hover:underline">
            <span className={`w-7 text-right font-semibold tabular-nums ${n > 0 && i === 0 ? "text-red-600 dark:text-red-400" : n > 0 ? "text-neutral-900 dark:text-white" : "text-neutral-400"}`}>{n}</span>
            <span className={n > 0 ? "text-neutral-700 dark:text-neutral-300" : "text-neutral-400"}>{n === 1 ? one : many}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentUser } = useApp();
  const { data: s, error } = useApi<DashboardSummary>("/dashboard/summary");
  const { data: orgs } = useApi<Organization[]>("/organizations");
  const { data: brief } = useApi<DailyBrief>(currentUser ? `/ai/daily-brief?user=${currentUser.id}` : null);
  const count = (st: string) => s?.pipeline.find((p) => p.status === st)?.count ?? 0;
  const maxStage = Math.max(1, ...(s?.pipeline.map((p) => p.count) ?? [1]));

  return (
    <>
      <PageHeader title="Bengaluru Water Intelligence" subtitle="Organization discovery, CRM and AI recommendations — Bengaluru" />
      <ErrorNote error={error} />
      {!s ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 mb-5">
          <StatCard label="Total organizations" value={s.totalOrganizations} onClick={() => navigate("/organizations")} />
          <StatCard label="New (7 days)" value={s.newOrganizations} onClick={() => navigate("/organizations")} />
          <StatCard label="CRM opportunities" value={s.crmOpportunities} onClick={() => navigate("/crm")} />
          <StatCard label="Active opportunities" value={s.activeOpportunities} onClick={() => navigate("/crm")} />
          <StatCard label="Proposals sent" value={s.proposalsSent} onClick={() => navigate("/crm")} />
          <StatCard label="Pilots" value={s.pilots} onClick={() => navigate("/crm")} />
          <StatCard label="Overdue follow-ups" value={s.overdueFollowUps} tone="red" onClick={() => navigate("/tasks?scope=overdue")} />
        </div>
      )}

      <Card
        title="Bengaluru map"
        actions={
          <Link to="/map" className="text-xs text-[var(--accent)] hover:underline">
            Open full map
          </Link>
        }
        bodyClassName="p-0"
        className="mb-5 overflow-hidden"
      >
        <div className="h-[420px]">{orgs ? <BengaluruMap organizations={orgs} className="h-full w-full" scrollWheelZoom={false} /> : <Spinner />}</div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card
          title="CRM pipeline"
          actions={
            <Link to="/crm" className="text-xs text-[var(--accent)] hover:underline">
              Open CRM
            </Link>
          }
        >
          <div className="space-y-1.5">
            {[...PIPELINE_STAGES, ...OUTCOME_STAGES].map((st) => (
              <Link key={st} to="/crm" className="flex items-center gap-3 text-sm group">
                <span className={`w-28 shrink-0 ${CLOSED_STATUSES.includes(st) && st !== "Converted" ? "text-neutral-400" : "text-neutral-700 dark:text-neutral-300"}`}>{st}</span>
                <span className="flex-1 h-2 rounded bg-neutral-100 dark:bg-neutral-900 overflow-hidden">
                  <span className="block h-full rounded" style={{ width: `${(count(st) / maxStage) * 100}%`, background: "var(--accent)" }} />
                </span>
                <span className="w-8 text-right tabular-nums font-medium">{count(st)}</span>
              </Link>
            ))}
          </div>
        </Card>
        <Card
          title="AI recommendations"
          actions={
            <Link to="/ai" className="text-xs text-[var(--accent)] hover:underline">
              View all
            </Link>
          }
        >
          {!brief ? (
            <Spinner />
          ) : (
            <div className="grid sm:grid-cols-[1fr_auto] gap-5">
              <RecommendationList items={brief.recommendations.slice(0, 5)} compact />
              <div className="sm:border-l sm:pl-5 border-neutral-200 dark:border-neutral-800">
                <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">Today's actions</div>
                <TodaysActions brief={brief} />
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
