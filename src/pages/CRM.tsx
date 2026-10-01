import React, { useState } from "react";
import { Link } from "react-router-dom";
import { OUTCOME_STAGES, PIPELINE_STAGES, type CrmStatus } from "../../shared/constants";
import type { Opportunity } from "../../shared/types";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { dueLabel, relativeDays, todayLocal } from "../lib/format";
import { useApp } from "../context/AppContext";
import { Badge, cx, ErrorNote, PageHeader, potentialTone, Select, Spinner } from "../components/ui";

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
      className="block rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-2.5 hover:border-neutral-400 dark:hover:border-neutral-600 transition cursor-grab active:cursor-grabbing"
    >
      <div className="text-sm font-medium leading-snug">{o.organization_name}</div>
      <div className="text-xs text-neutral-500 mt-0.5">
        {o.org_type}
        {o.area ? ` · ${o.area}` : ""}
      </div>
      <div className="flex flex-wrap gap-1 mt-2">
        {o.potential && <Badge tone={potentialTone(o.potential)}>{o.potential}</Badge>}
        {o.call_status !== "Not Started" && <Badge>{o.call_status}</Badge>}
        {o.proposal_status !== "Not Started" && <Badge tone="blue">Proposal {o.proposal_status.toLowerCase()}</Badge>}
        {o.pilot_status !== "Not Started" && <Badge tone="green">Pilot {o.pilot_status.toLowerCase()}</Badge>}
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] text-neutral-500">
        <span className={cx(!o.owner_name && "text-amber-600 font-medium")}>{o.owner_name ?? "Unassigned"}</span>
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
        className={cx("w-64 shrink-0 rounded-lg p-2 flex flex-col", muted ? "bg-neutral-100/60 dark:bg-neutral-900/40" : "bg-neutral-100 dark:bg-neutral-900", over === status && "ring-2 ring-[var(--accent)]")}
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <span className={cx("text-xs font-semibold uppercase tracking-wide", muted ? "text-neutral-400" : "text-neutral-600 dark:text-neutral-300")}>{status}</span>
          <span className="text-xs tabular-nums text-neutral-500">{items.length}</span>
        </div>
        <div className="space-y-2 min-h-16">
          {items.map((o) => (
            <OppCard key={o.id} o={o} onDragStart={setDragging} />
          ))}
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
            <div className="mb-4 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 py-3 text-sm text-neutral-600 dark:text-neutral-400">
              No opportunities yet. Open an organization on the <Link to="/map" className="text-[var(--accent)] hover:underline">Bengaluru map</Link> or in{" "}
              <Link to="/organizations" className="text-[var(--accent)] hover:underline">Organizations</Link> and choose “Add to CRM”.
            </div>
          )}
          <div className="flex gap-3 overflow-x-auto pb-4">
            {PIPELINE_STAGES.map((s) => column(s))}
            <div className="w-px bg-neutral-200 dark:bg-neutral-800 shrink-0" />
            {OUTCOME_STAGES.map((s) => column(s, true))}
          </div>
        </>
      )}
    </>
  );
}
