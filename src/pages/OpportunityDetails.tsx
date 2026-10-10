import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Building2, ChevronLeft, ChevronRight, Droplets, FileText, FolderKanban, History, KanbanSquare, ListChecks, PhoneCall, Plus, Users } from "lucide-react";
import { CALL_STATUSES, PILOT_STATUSES, POTENTIAL_LEVELS, PROPOSAL_STATUSES } from "../../shared/constants";
import type { Activity, Contact, Opportunity, PipelineStage, ProjectStakeholder, Task, WaterOpportunity } from "../../shared/types";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { formatDate, relativeDays } from "../lib/format";
import { findPipeline, isProjectOpportunity, neighbourStage, opportunityTitle, splitOpportunities } from "../lib/crmUtils";
import { stageTone } from "../lib/projectUtils";
import { useApp } from "../context/AppContext";
import InteractionForm from "../components/org/InteractionForm";
import TaskDialog from "../components/org/TaskDialog";
import Timeline from "../components/org/Timeline";
import TaskList from "../components/TaskList";
import { WaterOpportunityItem } from "../components/water/WaterOpportunitiesPanel";
import { Badge, Button, Card, confidenceTone, cx, EmptyState, ErrorNote, Field, Input, potentialTone, ProvenanceTag, Select, Spinner, Textarea } from "../components/ui";

interface Detail {
  opportunity: Opportunity;
  stages: PipelineStage[];
  organization: {
    id: number;
    name: string;
    org_type: string;
    area: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    data_confidence: string;
    field_sources: Record<string, { provenance: "Verified" | "Unverified" | "Estimated" | "AI Inference" | "Unknown"; source?: string | null }>;
    ai_potential: string | null;
    source_label: string | null;
  };
  contacts: Contact[];
  other_opportunities: Opportunity[];
  project: { id: number; name: string; project_type: string | null; lifecycle_stage: string; scale: string; area: string | null; unit_count: number | null } | null;
  stakeholders: ProjectStakeholder[];
  water_opportunities: WaterOpportunity[];
  tasks: Task[];
  activities: Activity[];
}

const kindTone = (k?: string) => (k === "won" ? "green" : k === "lost" ? "red" : "blue") as "green" | "red" | "blue";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1.5 text-sm items-center">
      <dt className="text-[var(--text-3)]">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function OpportunityLink({ o }: { o: Opportunity }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5 py-1.5">
      <Link to={`/crm/${o.id}`} className="text-sm font-medium hover:underline">
        {opportunityTitle(o)}
      </Link>
      {isProjectOpportunity(o) && o.project_name && <span className="text-xs text-[var(--text-3)]">on {o.project_name}</span>}
      <Badge tone={kindTone(o.stage_kind)}>{o.status}</Badge>
      <span className="text-xs text-[var(--text-3)]">{o.owner_name ?? "Unassigned"}</span>
    </li>
  );
}

export default function OpportunityDetails() {
  const { id } = useParams();
  const { catalog, activeUsers, invalidate, toast } = useApp();
  const { data, error } = useApi<Detail>(`/crm/${id}`);
  const [taskOpen, setTaskOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (data) {
      setTitle(data.opportunity.title ?? "");
      setNotes(data.opportunity.notes ?? "");
    }
  }, [data]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  const o = data.opportunity;
  const pipeline = findPipeline(catalog?.pipelines, o.pipeline);
  const project = isProjectOpportunity(o);
  const types = (catalog?.opportunityTypes ?? []).filter((t) => t.default_pipeline === o.pipeline).map((t) => t.name);
  const prev = neighbourStage(pipeline, o.status, -1);
  const next = neighbourStage(pipeline, o.status, 1);
  const others = splitOpportunities(data.other_opportunities);
  const otherStakeholders = data.stakeholders.filter((s) => s.organization_id !== o.organization_id);
  const customerLinks = data.stakeholders.filter((s) => s.organization_id === o.organization_id);

  async function patch(body: object, done?: string) {
    try {
      await api.patch(`/crm/${o.id}`, body);
      if (done) toast(done);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
      invalidate();
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-3)]">
        <Link to={project ? "/crm?pipeline=project" : "/crm"} className="hover:underline">
          ← {project ? "Project opportunities" : "CRM board"}
        </Link>
        {data.project && (
          <Link to={`/projects/${data.project.id}?tab=crm`} className="hover:underline">
            ← Project: {data.project.name}
          </Link>
        )}
        <Link to={`/organizations/${o.organization_id}`} className="hover:underline">
          ← Organization: {o.organization_name}
        </Link>
      </div>
      <div className="mt-2 mb-5">
        <div className={cx("text-[11px] font-semibold uppercase tracking-wider", project ? "text-blue-700 dark:text-blue-300" : "text-[var(--text-3)]")}>
          {project ? "Project opportunity" : "Organization / relationship opportunity"}
        </div>
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight mt-1">{!project && !o.title ? `${o.organization_name} — ${o.opportunity_type}` : opportunityTitle(o)}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Badge tone="purple">{o.opportunity_type}</Badge>
          <Badge tone={project ? "blue" : "neutral"}>{pipeline?.label ?? o.pipeline} pipeline</Badge>
          <Badge tone={kindTone(o.stage_kind)}>
            Stage: {o.status}
            {o.stage_kind === "won" ? " (won)" : o.stage_kind === "lost" ? " (closed)" : o.stage_is_outcome ? " (outcome)" : ""}
          </Badge>
          {o.potential && (
            <Badge tone={potentialTone(o.potential)} title={o.potential_source === "ai" ? "The organization's AI-inferred potential; the team has not rated this opportunity" : "The team's rating"}>
              Potential: {o.potential}
              {o.potential_source === "ai" ? " (AI Inference)" : ""}
            </Badge>
          )}
          {o.interventions?.map((i) => (
            <Badge key={i} tone="blue">
              <Droplets size={11} /> {i}
            </Badge>
          ))}
        </div>
      </div>

      <div className="grid xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-6 items-start">
        <div className="space-y-6">
          <Card icon={KanbanSquare} title="Opportunity">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Button size="sm" disabled={!prev} onClick={() => patch({ stage_step: -1 }, `Moved back to ${prev}`)} aria-label="Previous stage">
                <ChevronLeft size={13} /> {prev ?? "Previous"}
              </Button>
              <Select
                className="!w-auto"
                value={o.status}
                onChange={(e) => patch({ status: e.target.value }, `Stage: ${e.target.value}`)}
                options={(data.stages ?? []).map((s) => ({ value: s.name, label: s.is_outcome ? `${s.name} (outcome)` : s.name }))}
                aria-label="Stage"
              />
              <Button size="sm" variant="primary" disabled={!next} onClick={() => patch({ stage_step: 1 }, `Moved to ${next}`)} aria-label="Next stage">
                {next ?? "Next"} <ChevronRight size={13} />
              </Button>
            </div>
            <dl className="divide-y divide-[var(--border)]">
              <Row label="Title">
                <div className="flex gap-2">
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={opportunityTitle({ ...o, title: null })} aria-label="Title" />
                  {title !== (o.title ?? "") && (
                    <Button size="sm" onClick={() => patch({ title }, "Title saved")}>
                      Save
                    </Button>
                  )}
                </div>
              </Row>
              <Row label="Type">
                <Select value={o.opportunity_type} onChange={(e) => patch({ opportunity_type: e.target.value })} options={types} aria-label="Opportunity type" />
              </Row>
              <Row label="Owner">
                <Select value={o.owner_id ? String(o.owner_id) : ""} onChange={(e) => patch({ owner_id: e.target.value ? Number(e.target.value) : null })} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Unassigned" aria-label="Owner" />
              </Row>
              <Row label="Potential">
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    className="!w-auto"
                    value={o.potential_source === "team" ? o.potential ?? "" : ""}
                    onChange={(e) => patch({ potential: e.target.value || null })}
                    options={POTENTIAL_LEVELS}
                    placeholder="Not rated"
                    aria-label="Potential"
                  />
                  {data.organization.ai_potential && <span className="text-xs text-[var(--text-3)]">Organization: {data.organization.ai_potential} (AI Inference)</span>}
                </div>
              </Row>
              <Row label="Contact person">
                <Select value={o.contact_id ? String(o.contact_id) : ""} onChange={(e) => patch({ contact_id: e.target.value ? Number(e.target.value) : null })} options={data.contacts.map((c) => ({ value: c.id, label: c.designation ? `${c.name} — ${c.designation}` : c.name }))} placeholder="None" aria-label="Contact person" />
              </Row>
              <Row label="Call">
                <Select value={o.call_status} onChange={(e) => patch({ call_status: e.target.value })} options={CALL_STATUSES} aria-label="Call status" />
              </Row>
              <Row label="Proposal">
                <div className="flex flex-wrap items-center gap-2">
                  <Select className="!w-auto" value={o.proposal_status} onChange={(e) => patch({ proposal_status: e.target.value })} options={PROPOSAL_STATUSES} aria-label="Proposal status" />
                  {o.proposal_sent_at && <span className="text-xs text-[var(--text-3)]">Sent {formatDate(o.proposal_sent_at)}</span>}
                </div>
              </Row>
              <Row label={project ? "Project pilot" : "Pilot"}>
                <Select value={o.pilot_status} onChange={(e) => patch({ pilot_status: e.target.value })} options={PILOT_STATUSES} aria-label="Pilot status" />
              </Row>
              <Row label="Notes">
                <div className="space-y-2">
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} aria-label="Notes" />
                  {notes !== (o.notes ?? "") && (
                    <Button size="sm" onClick={() => patch({ notes }, "Notes saved")}>
                      Save notes
                    </Button>
                  )}
                </div>
              </Row>
            </dl>
            <p className="text-[11px] text-[var(--text-3)] mt-3">
              Created {formatDate(o.created_at)} · last activity {relativeDays(o.last_activity_at)}. Stage changes are recorded on the timeline; recorded interactions only move the stage forward.
            </p>
          </Card>

          <Card icon={PhoneCall} title="Record interaction" description="Calls, meetings, proposals and notes — on this opportunity's timeline">
            <InteractionForm opportunityId={o.id} ownerId={o.owner_id} />
          </Card>

          <Card
            icon={ListChecks}
            title="Tasks / follow-ups"
            actions={
              <Button size="sm" onClick={() => setTaskOpen(true)}>
                <Plus size={12} /> Add
              </Button>
            }
            bodyClassName="py-1"
          >
            <TaskList tasks={data.tasks} showOrg={false} emptyText="No tasks for this opportunity" />
          </Card>

          <Card icon={History} title="Timeline" description={project ? "Activity on this project opportunity (also shown on the project and organization timelines)" : "Activity on this opportunity"}>
            <Timeline activities={data.activities} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card icon={Building2} title={project ? "Customer organization" : "Organization"}>
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/organizations/${o.organization_id}`} className="text-[15px] font-semibold hover:underline">
                {o.organization_name}
              </Link>
              <Badge>{data.organization.org_type}</Badge>
              <ProvenanceTag fs={data.organization.field_sources?.org_type} />
            </div>
            <div className="text-xs text-[var(--text-3)] mt-1">
              {[data.organization.area, data.organization.phone, data.organization.email].filter(Boolean).join(" · ") || "No address or contact details recorded"}
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold text-[var(--text-2)] mb-1 flex items-center gap-1">
                <Users size={12} /> Contacts
              </div>
              {data.contacts.length ? (
                <ul className="text-sm space-y-0.5">
                  {data.contacts.map((c) => (
                    <li key={c.id}>
                      {c.name}
                      {c.designation && <span className="text-[var(--text-3)]"> — {c.designation}</span>}
                      {c.id === o.contact_id && <Badge className="ml-1.5">Contact for this opportunity</Badge>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--text-3)]">No contact people recorded.</p>
              )}
            </div>
            <div className="mt-4">
              <div className="text-xs font-semibold text-[var(--text-2)] mb-1">Relationship context</div>
              {!others.relationship.length && !others.project.length ? (
                <p className="text-xs text-[var(--text-3)]">No other CRM opportunities with this organization.</p>
              ) : (
                <>
                  {others.relationship.length > 0 && (
                    <>
                      <div className="text-[11px] text-[var(--text-3)]">Relationship opportunities</div>
                      <ul>{others.relationship.map((x) => <OpportunityLink key={x.id} o={x} />)}</ul>
                    </>
                  )}
                  {others.project.length > 0 && (
                    <>
                      <div className="text-[11px] text-[var(--text-3)] mt-1">Project opportunities</div>
                      <ul>{others.project.map((x) => <OpportunityLink key={x.id} o={x} />)}</ul>
                    </>
                  )}
                </>
              )}
            </div>
          </Card>

          {data.project && (
            <Card icon={FolderKanban} title="Project">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/projects/${data.project.id}`} className="text-[15px] font-semibold hover:underline">
                  {data.project.name}
                </Link>
                <Badge>{data.project.project_type ?? "Type unknown"}</Badge>
                <Badge tone={stageTone(data.project.lifecycle_stage)}>{data.project.lifecycle_stage}</Badge>
              </div>
              <div className="text-xs text-[var(--text-3)] mt-1">
                {[data.project.area, data.project.scale !== "Unknown" ? `${data.project.scale} scale` : null, data.project.unit_count ? `${data.project.unit_count.toLocaleString("en-IN")} units` : null].filter(Boolean).join(" · ") || "Location and scale unknown"}
              </div>
              <div className="mt-3 text-sm">
                <span className="text-[var(--text-3)]">Customer's role: </span>
                {customerLinks.length ? (
                  customerLinks.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1 mr-2">
                      {s.role}
                      {s.is_primary && <Badge tone="blue">Primary</Badge>}
                      <ProvenanceTag fs={{ provenance: s.provenance, source: s.source }} />
                    </span>
                  ))
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">No longer linked as a stakeholder</span>
                )}
              </div>
              <div className="mt-4">
                <div className="text-xs font-semibold text-[var(--text-2)] mb-1">Other stakeholders</div>
                {otherStakeholders.length ? (
                  <ul className="text-sm divide-y divide-[var(--border)]">
                    {otherStakeholders.map((s) => (
                      <li key={s.id} className="py-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[var(--text-3)] w-36 shrink-0">{s.role}</span>
                        <Link to={`/organizations/${s.organization_id}`} className="hover:underline">
                          {s.organization_name}
                        </Link>
                        <ProvenanceTag fs={{ provenance: s.provenance, source: s.source }} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-[var(--text-3)]">No other organizations linked to the project.</p>
                )}
              </div>
            </Card>
          )}

          <Card icon={Droplets} title="Water opportunity" description="The approved water opportunity this CRM record came from or is linked to">
            {data.water_opportunities.length ? (
              <div className="space-y-3">
                {data.water_opportunities.map((w) => (
                  <div key={w.id}>
                    {w.id === o.source_water_opportunity_id && <div className="text-[11px] text-[var(--text-3)] mb-1">Converted from this water opportunity</div>}
                    <ul>
                      <WaterOpportunityItem w={w} readOnly />
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No water opportunity linked" icon={Droplets} compact>
                {project ? "Approved water opportunities on the project can be converted or linked from the project's Opportunities tab." : "Approved organization-level water opportunities can be converted from the organization page."}
              </EmptyState>
            )}
          </Card>

          <Card icon={FileText} title="Sources">
            <ul className="text-xs text-[var(--text-2)] space-y-1.5">
              <li>
                Organization record: {data.organization.source_label ?? "source not recorded"} · data confidence{" "}
                <Badge tone={confidenceTone(data.organization.data_confidence)}>{data.organization.data_confidence}</Badge>
              </li>
              {customerLinks.map((s) => (
                <li key={s.id}>
                  Stakeholder link ({s.role}): {s.provenance}
                  {s.source ? `, source: ${s.source}` : ""}
                </li>
              ))}
              {data.water_opportunities.map((w) => (
                <li key={w.id}>
                  {w.intervention_type}: {w.provenance}, confidence {w.confidence}
                  {w.reviewer_name ? `, approved by ${w.reviewer_name}` : ""}
                  {w.evidence_refs.length ? ` — evidence from ${[...new Set(w.evidence_refs.map((r) => r.source).filter(Boolean))].join("; ") || "recorded facts"}` : ""}
                </li>
              ))}
              {o.potential_source === "ai" && <li>Potential: the organization's AI-inferred rating (not a team judgement).</li>}
            </ul>
          </Card>
        </div>
      </div>

      <TaskDialog
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        opportunityId={o.id}
        contextLabel={project ? `Project opportunity: ${opportunityTitle(o)} (${o.organization_name})` : `Opportunity: ${opportunityTitle(o)} (${o.organization_name})`}
      />
    </>
  );
}
