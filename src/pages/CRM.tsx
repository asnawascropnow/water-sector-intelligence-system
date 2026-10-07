import React, { useState } from "react";
import { Link } from "react-router-dom";
import { OUTCOME_STAGES, PIPELINE_STAGES, type CrmStatus } from "../../shared/constants";
import type { Opportunity } from "../../shared/types";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { dueLabel, relativeDays, todayLocal } from "../lib/format";
import { useApp } from "../context/AppContext";
import { Avatar, Badge, cx, ErrorNote, PageHeader, potentialTone, Select, Spinner } from "../components/ui";

function OppCard({ o, onDragStart }: { o: Opportunity; onDragStart: (id: number) => void }) {
  const overdue = o.next_follow_up && o.next_follow_up < todayLocal();
  return (
    <Link
      to={`/organizations/${o.organization_id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(o.id));
        onDragStart(o.id);
      }}
      className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-card)] hover:border-[var(--border-strong)] hover:shadow-md transition cursor-grab active:cursor-grabbing"
    >
      <div className="text-[13px] font-semibold leading-snug">{o.organization_name}</div>
      <div className="text-xs text-[var(--text-3)] mt-0.5">
        {o.org_type}
        {o.area ? ` · ${o.area}` : ""}
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {o.potential && <Badge tone={potentialTone(o.potential)}>{o.potential}</Badge>}
        {o.call_status !== "Not Started" && <Badge>{o.call_status}</Badge>}
        {o.proposal_status !== "Not Started" && <Badge tone="blue">Proposal {o.proposal_status.toLowerCase()}</Badge>}
        {o.pilot_status !== "Not Started" && <Badge tone="green">Pilot {o.pilot_status.toLowerCase()}</Badge>}
      </div>
      <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-[var(--border)] text-[11px] text-[var(--text-3)]">
        <span className={cx("inline-flex items-center gap-1.5 min-w-0", !o.owner_name && "text-amber-600 font-medium")}>{o.owner_name && <Avatar name={o.owner_name} size={18} />}<span className="truncate">{o.owner_name ?? "Unassigned"}</span></span>
        <span className={cx(overdue && "text-red-600 dark:text-red-400 font-medium")}>{o.next_follow_up ? `Follow-up: ${dueLabel(o.next_follow_up)}` : `Last: ${relativeDays(o.last_activity_at)}`}</span>
      </div>
    </Link>
  );
}

export default function CRM() {
  const { activeUsers, invalidate, toast } = useApp();
  const [owner, setOwner] = useState("");
  const { data: opps, error, setData } = useApi<Opportunity[]>(`/crm${owner ? `?owner=${owner}` : ""}`);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<string | null>(null);

  async function move(id: number, status: CrmStatus) {
    const opp = opps?.find((o) => o.id === id);
    if (!opp || opp.status === status) return;
    setData((d) => d?.map((o) => (o.id === id ? { ...o, status } : o)) ?? d);
    try {
      await api.patch(`/crm/${id}`, { status });
      toast(`${opp.organization_name} → ${status}`);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
      invalidate();
    }
  }

  const column = (status: CrmStatus, muted = false) => {
    const items = (opps ?? []).filter((o) => o.status === status);
    return (
      <div
        key={status}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(status);
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(null);
          const id = Number(e.dataTransfer.getData("text/plain")) || dragging;
          if (id) move(id, status);
        }}
        className={cx("w-72 shrink-0 rounded-xl p-2.5 flex flex-col min-h-[calc(100vh-15rem)] border", muted ? "bg-gray-50/60 dark:bg-white/[0.02] border-dashed border-[var(--border)]" : "bg-[#eceef2] dark:bg-white/[0.04] border-transparent", over === status && "ring-2 ring-[var(--accent)]")}
      >
        <div className="flex items-center justify-between px-1.5 pt-0.5 pb-2.5">
          <span className={cx("text-xs font-semibold", muted ? "text-[var(--text-3)]" : "text-[var(--text)]")}>{status}</span>
          <span className="rounded-full bg-[var(--surface)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-2)] ring-1 ring-[var(--border)]">{items.length}</span>
        </div>
        <div className="space-y-2 flex-1">
          {items.map((o) => (
            <OppCard key={o.id} o={o} onDragStart={setDragging} />
          ))}
          {!items.length && <div className="rounded-lg border border-dashed border-[var(--border-strong)] py-6 text-center text-xs text-[var(--text-3)]">Drop here</div>}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader
        title="CRM — Our opportunities"
        subtitle="Organizations the team is actively working on. Drag a card to change its stage; every change is recorded in the organization's timeline."
        actions={
          <Select className="!w-auto" value={owner} onChange={(e) => setOwner(e.target.value)} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="All owners" aria-label="Owner" />
        }
      />
      <ErrorNote error={error} />
      {!opps ? (
        <Spinner />
      ) : (
        <>
          {!opps.length && (
            <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--accent-soft)] px-4 py-3 text-sm text-[var(--text-2)]">
              No opportunities yet. Open an organization on the <Link to="/map" className="text-[var(--accent)] hover:underline">Bengaluru map</Link> or in{" "}
              <Link to="/organizations" className="text-[var(--accent)] hover:underline">Organizations</Link> and choose “Add to CRM”.
            </div>
          )}
          <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
            {PIPELINE_STAGES.map((s) => column(s))}
            <div className="w-px bg-[var(--border)] shrink-0 mx-1" />
            {OUTCOME_STAGES.map((s) => column(s, true))}
          </div>
        </>
      )}
    </>
  );
}
