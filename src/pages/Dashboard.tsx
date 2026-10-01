import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Activity,
  AlarmClock,
  Bot,
  Building2,
  CalendarCheck,
  ChevronRight,
  FileText,
  FlaskConical,
  KanbanSquare,
  Map as MapIcon,
  PhoneCall,
  Plus,
  Sparkles,
  Upload,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { OUTCOME_STAGES, PIPELINE_STAGES } from "../../shared/constants";
import type { DailyBrief, DashboardSummary, Organization } from "../../shared/types";
import { useApi } from "../lib/useApi";
import { formatDate, todayLocal } from "../lib/format";
import { useApp } from "../context/AppContext";
import BengaluruMap from "../components/map/BengaluruMap";
import RecommendationList from "../components/RecommendationList";
import OrganizationForm from "../components/org/OrganizationForm";
import { Button, Card, cx, ErrorNote, PageHeader, Spinner, StatCard } from "../components/ui";

const linkCls = "inline-flex items-center gap-0.5 text-xs font-medium text-[var(--accent-text)] hover:underline";

/** Daily Reminder Agent output as a compact action list. */
export function TodaysActions({ brief }: { brief: DailyBrief }) {
  const c = brief.counts;
  const rows: { n: number; one: string; many: string; to: string; icon: LucideIcon; urgent?: boolean }[] = [
    { n: c.overdueFollowUps, one: "Overdue follow-up", many: "Overdue follow-ups", to: "/tasks?scope=overdue", icon: AlarmClock, urgent: true },
    { n: c.followUpsDue, one: "Follow-up due today", many: "Follow-ups due today", to: "/tasks?scope=today", icon: CalendarCheck },
    { n: c.callsToday, one: "Call today", many: "Calls today", to: "/tasks?scope=today", icon: PhoneCall },
    { n: c.proposalsAwaitingResponse, one: "Proposal awaiting response", many: "Proposals awaiting response", to: "/crm", icon: FileText },
    { n: c.newOpportunities, one: "New opportunity", many: "New opportunities", to: "/crm", icon: Sparkles },
    { n: c.unassignedOpportunities, one: "Unassigned opportunity", many: "Unassigned opportunities", to: "/crm", icon: UserX },
    { n: c.pendingImportRecords, one: "Imported record to review", many: "Imported records to review", to: "/import", icon: Upload },
  ];
  return (
    <ul className="-mx-2">
      {rows.map(({ n, one, many, to, icon: Icon, urgent }) => (
        <li key={one}>
          <Link to={to} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--surface-2)] transition">
            <span
              className={cx(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                n > 0 ? (urgent ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300" : "bg-[var(--accent-soft)] text-[var(--accent-text)]") : "bg-gray-100 text-gray-400 dark:bg-white/5",
              )}
            >
              <Icon size={14} />
            </span>
            <span className={cx("flex-1 text-[13px]", n > 0 ? "text-[var(--text)]" : "text-[var(--text-3)]")}>{n === 1 ? one : many}</span>
            <span
              className={cx(
                "min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums",
                n > 0 ? (urgent ? "bg-red-600 text-white" : "bg-[var(--accent)] text-white") : "bg-gray-100 text-gray-400 dark:bg-white/5",
              )}
            >
              {n}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Pipeline({ summary }: { summary: DashboardSummary }) {
  const count = (st: string) => summary.pipeline.find((p) => p.status === st)?.count ?? 0;
  const max = Math.max(1, ...PIPELINE_STAGES.map(count));
  const total = summary.crmOpportunities;
  return (
    <div>
      <div className="space-y-2.5">
        {PIPELINE_STAGES.map((st) => (
          <Link key={st} to="/crm" className="flex items-center gap-3 text-[13px] group">
            <span className="w-28 shrink-0 whitespace-nowrap text-[var(--text-2)] group-hover:text-[var(--text)]">{st}</span>
            <span className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-white/5 overflow-hidden">
              <span className="block h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(count(st) / max) * 100}%` }} />
            </span>
            <span className="w-6 text-right tabular-nums font-semibold">{count(st)}</span>
          </Link>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-3)]">
        {OUTCOME_STAGES.map((st) => (
          <span key={st}>
            {st} <span className="font-semibold text-[var(--text-2)] tabular-nums">{count(st)}</span>
          </span>
        ))}
        <span className="ml-auto">
          Total <span className="font-semibold text-[var(--text-2)] tabular-nums">{total}</span>
        </span>
      </div>
    </div>
  );
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { currentUser } = useApp();
  const [creating, setCreating] = useState(false);
  const { data: s, error } = useApi<DashboardSummary>("/dashboard/summary");
  const { data: orgs } = useApi<Organization[]>("/organizations");
  const { data: brief } = useApi<DailyBrief>(currentUser ? `/ai/daily-brief?user=${currentUser.id}` : null);

  return (
    <>
      <PageHeader
        eyebrow={`${formatDate(todayLocal(), { weekday: "long", day: "numeric", month: "long" })} · ${greeting()}${currentUser ? `, ${currentUser.name}` : ""}`}
        title="Bengaluru Water Intelligence"
        subtitle="Organization discovery, CRM and AI recommendations for Bengaluru."
        actions={
          <>
            <Link to="/import">
              <Button>
                <Upload size={14} /> Import data
              </Button>
            </Link>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Add organization
            </Button>
          </>
        }
      />
      <ErrorNote error={error} />

      {!s ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3 lg:gap-4 mb-6">
          <StatCard label="Total organizations" value={s.totalOrganizations} icon={Building2} tone="blue" onClick={() => navigate("/organizations")} />
          <StatCard label="New organizations (7 days)" value={s.newOrganizations} icon={Sparkles} tone="cyan" onClick={() => navigate("/organizations")} />
          <StatCard label="CRM opportunities" value={s.crmOpportunities} icon={KanbanSquare} tone="violet" onClick={() => navigate("/crm")} />
          <StatCard label="Active opportunities" value={s.activeOpportunities} icon={Activity} tone="green" onClick={() => navigate("/crm")} />
          <StatCard label="Proposals sent" value={s.proposalsSent} icon={FileText} tone="amber" onClick={() => navigate("/crm")} />
          <StatCard label="Pilots" value={s.pilots} icon={FlaskConical} tone="green" onClick={() => navigate("/crm")} />
          <StatCard label="Overdue follow-ups" value={s.overdueFollowUps} icon={AlarmClock} tone="gray" alert={s.overdueFollowUps > 0} onClick={() => navigate("/tasks?scope=overdue")} />
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6 mb-6">
        <Card
          className="lg:col-span-2 overflow-hidden"
          icon={MapIcon}
          title="Bengaluru map"
          description={orgs ? `${orgs.filter((o) => o.lat != null).length} organizations located` : undefined}
          actions={
            <Link to="/map" className={linkCls}>
              Open full map <ChevronRight size={13} />
            </Link>
          }
          bodyClassName="p-0 relative"
        >
          <div className="h-[420px] lg:h-full lg:min-h-[480px]">{orgs ? <BengaluruMap organizations={orgs} className="h-full w-full" scrollWheelZoom={false} /> : <Spinner />}</div>
        </Card>

        <div className="flex flex-col gap-6 min-w-0">
          <Card icon={CalendarCheck} title="Today's actions" description="Daily Reminder Agent" bodyClassName="px-5 py-3">
            {brief ? <TodaysActions brief={brief} /> : <Spinner />}
          </Card>
          <Card
            icon={KanbanSquare}
            title="CRM pipeline"
            actions={
              <Link to="/crm" className={linkCls}>
                Open CRM <ChevronRight size={13} />
              </Link>
            }
          >
            {s ? <Pipeline summary={s} /> : <Spinner />}
          </Card>
        </div>
      </div>

      <Card
        icon={Bot}
        title="AI recommendations"
        description="Top priorities from the Next Action and Opportunity agents, with the reason for each"
        actions={
          <Link to="/ai" className={linkCls}>
            View all{brief ? ` (${brief.recommendations.length})` : ""} <ChevronRight size={13} />
          </Link>
        }
      >
        {brief ? (
          <div className="grid lg:grid-cols-2 lg:gap-x-10">
            <RecommendationList items={brief.recommendations.slice(0, 3)} compact />
            {brief.recommendations.length > 3 && (
              <div className="border-t lg:border-t-0 border-[var(--border)] mt-3.5 pt-3.5 lg:mt-0 lg:pt-0">
                <RecommendationList items={brief.recommendations.slice(3, 6)} compact />
              </div>
            )}
          </div>
        ) : (
          <Spinner />
        )}
      </Card>

      <OrganizationForm open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
