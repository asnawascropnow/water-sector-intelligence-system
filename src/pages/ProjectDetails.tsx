import React, { useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Droplets, ExternalLink, KanbanSquare, ListChecks, Pencil, Plus, Star, Trash2, Users } from "lucide-react";
import type { Activity, Fact, Opportunity, Project, ProjectStakeholder, Task, WaterOpportunity } from "../../shared/types";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { displayUrl, formatDate, relativeDays } from "../lib/format";
import { groupStakeholders, stageTone } from "../lib/projectUtils";
import { useApp } from "../context/AppContext";
import FactsPanel from "../components/facts/FactsPanel";
import ProjectForm from "../components/project/ProjectForm";
import StakeholderDialog from "../components/project/StakeholderDialog";
import ProjectCrmDialog from "../components/project/ProjectCrmDialog";
import LocationMap from "../components/map/LocationMap";
import Timeline from "../components/org/Timeline";
import TaskDialog from "../components/org/TaskDialog";
import TaskList from "../components/TaskList";
import WaterOpportunitiesPanel from "../components/water/WaterOpportunitiesPanel";
import { isLiveWater } from "../lib/waterUtils";
import { opportunityTitle } from "../lib/crmUtils";
import { Badge, Button, Card, confidenceTone, EmptyState, ErrorNote, potentialTone, ProvenanceTag, Spinner, statusTone, Tabs } from "../components/ui";

interface Detail {
  merged_into?: number;
  project: Project;
  stakeholders: ProjectStakeholder[];
  facts: Fact[];
  crm_opportunities: Opportunity[];
  water_opportunities: WaterOpportunity[];
}

const TABS = ["overview", "stakeholders", "water", "opportunities", "crm", "activity"] as const;
type TabKey = (typeof TABS)[number];

function Row({ label, value, fs, children }: { label: string; value?: React.ReactNode; fs?: Project["field_sources"][string]; children?: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "" || value === "Unknown";
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-[var(--text-3)]">{label}</dt>
      <dd className="min-w-0 break-words flex flex-wrap items-center gap-1.5">
        {children ?? (empty ? <span className="text-[var(--text-3)]">Unknown</span> : value)}
        {!empty && fs && <ProvenanceTag fs={fs} />}
      </dd>
    </div>
  );
}

function Overview({ d, onEdit }: { d: Detail; onEdit: () => void }) {
  const p = d.project;
  const fs = p.field_sources ?? {};
  const key = groupStakeholders(d.stakeholders, []).flatMap((g) => g.items.filter((s) => s.is_primary || g.items.length === 1));
  return (
    <div className="grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-6 items-start">
      <Card
        title="Project details"
        actions={
          <Button size="sm" onClick={onEdit}>
            <Pencil size={12} /> Edit
          </Button>
        }
      >
        <dl className="divide-y divide-[var(--border)]">
          <Row label="Type" value={p.project_type} fs={fs.project_type} />
          <Row label="Lifecycle stage" value={p.lifecycle_stage} fs={fs.lifecycle_stage} />
          <Row label="Description" value={p.description} fs={fs.description} />
          <Row label="Address" value={p.address} fs={fs.address} />
          <Row label="Area" value={p.area} fs={fs.area} />
          <Row label="Pincode" value={p.pincode} fs={fs.pincode} />
          <Row label="Location" value={p.lat != null ? `${p.lat.toFixed(5)}, ${p.lng!.toFixed(5)}` : null} fs={fs.location} />
          <Row
            label="Website"
            value={
              p.website && (
                <a href={p.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent-text)] hover:underline">
                  {displayUrl(p.website)} <ExternalLink size={11} />
                </a>
              )
            }
            fs={fs.website}
          />
          <Row label="Scale" value={p.scale} fs={fs.scale} />
          <Row label="Built-up area" value={p.built_up_area_sqft != null ? `${Number(p.built_up_area_sqft).toLocaleString("en-IN")} sq ft` : null} fs={fs.built_up_area_sqft} />
          <Row label="Buildings" value={p.building_count} fs={fs.building_count} />
          <Row label="Units" value={p.unit_count != null ? p.unit_count.toLocaleString("en-IN") : null} fs={fs.unit_count} />
          <Row label="Notes" value={p.notes} />
          <Row label="Source" value={p.source_label} />
          <Row label="Data confidence">
            <Badge tone={confidenceTone(p.data_confidence)}>{p.data_confidence}</Badge>
          </Row>
          <Row label="Recorded" value={`${formatDate(p.created_at)}${p.created_by_name ? ` by ${p.created_by_name}` : ""}${p.updated_by_name ? ` · last edited by ${p.updated_by_name}` : ""}`} />
        </dl>
      </Card>
      <div className="space-y-6">
        <Card title="Location">
          {p.lat != null ? (
            <div className="h-56 rounded-lg overflow-hidden border border-[var(--border)]">
              <LocationMap lat={p.lat} lng={p.lng!} label={p.name} className="h-full w-full" />
            </div>
          ) : (
            <EmptyState title="No map location recorded" compact>
              Add coordinates with Edit to place this project on the map.
            </EmptyState>
          )}
        </Card>
        <Card title="Key stakeholders">
          {!key.length ? (
            <EmptyState title="No organizations linked yet" icon={Users} compact />
          ) : (
            <ul className="space-y-1.5 text-sm">
              {key.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 text-[var(--text-3)]">{s.role}</span>
                  <Link to={`/organizations/${s.organization_id}`} className="font-medium hover:underline truncate">
                    {s.organization_name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stakeholders({ d }: { d: Detail }) {
  const { catalog, invalidate, toast } = useApp();
  const [dialog, setDialog] = useState<{ link?: ProjectStakeholder } | null>(null);
  const groups = useMemo(() => groupStakeholders(d.stakeholders, catalog?.stakeholderRoles ?? []), [d.stakeholders, catalog]);

  async function remove(s: ProjectStakeholder) {
    const reason = window.prompt(`Remove ${s.organization_name} as ${s.role}? Optional reason (kept in the history):`, "");
    if (reason === null) return;
    try {
      await api.del(`/projects/${d.project.id}/stakeholders/${s.id}`, { reason: reason.trim() || null });
      toast(`${s.organization_name} removed`);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <Card
      title="Stakeholders"
      description="Organizations involved in this project, by role"
      actions={
        <Button size="sm" variant="primary" onClick={() => setDialog({})}>
          <Plus size={13} /> Add stakeholder
        </Button>
      }
    >
      {!groups.length ? (
        <EmptyState title="No organizations linked yet" icon={Users}>
          Link the developer, architect, contractor and consultants working on this project.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.role}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-3)] mb-1.5">{g.role}</h3>
              <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                {g.items.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link to={`/organizations/${s.organization_id}`} className="text-sm font-medium hover:underline">
                          {s.organization_name}
                        </Link>
                        <span className="text-xs text-[var(--text-3)]">{s.org_type}</span>
                        {s.is_primary && (
                          <Badge tone="blue">
                            <Star size={10} /> Primary
                          </Badge>
                        )}
                        <ProvenanceTag fs={{ provenance: s.provenance, source: s.source }} />
                        <Badge tone={confidenceTone(s.confidence)}>Confidence: {s.confidence}</Badge>
                      </div>
                      <div className="text-[11px] text-[var(--text-3)] mt-0.5">
                        {s.source ? `Source: ${s.source}` : "No source recorded"}
                        {s.notes ? ` · ${s.notes}` : ""}
                        {s.updated_by_name ? ` · edited by ${s.updated_by_name}` : s.created_by_name ? ` · added by ${s.created_by_name}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ link: s })} aria-label={`Edit ${s.organization_name}`}>
                        <Pencil size={13} /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(s)} aria-label={`Remove ${s.organization_name}`}>
                        <Trash2 size={13} /> Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <StakeholderDialog projectId={d.project.id} link={dialog?.link} open={Boolean(dialog)} onClose={() => setDialog(null)} />
    </Card>
  );
}

function Crm({ d }: { d: Detail }) {
  const { catalog } = useApp();
  const [open, setOpen] = useState(false);
  const pipelineLabel = (k: string) => catalog?.pipelines.find((p) => p.key === k)?.label ?? k;
  return (
    <Card
      title="CRM opportunities for this project"
      description="Project opportunities are tracked separately from each organization's general relationship"
      actions={
        <Button size="sm" variant="primary" onClick={() => setOpen(true)} disabled={!d.stakeholders.length} title={d.stakeholders.length ? undefined : "Link a stakeholder organization first"}>
          <Plus size={13} /> New project opportunity
        </Button>
      }
    >
      {!d.crm_opportunities.length ? (
        <EmptyState title="No CRM opportunities linked to this project" icon={KanbanSquare}>
          {d.stakeholders.length ? "Create one for a stakeholder organization when the team decides to pursue this project." : "Link a stakeholder organization first, then create an opportunity for it."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {d.crm_opportunities.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link to={`/crm/${o.id}`} className="text-sm font-medium hover:underline">
                    {opportunityTitle(o)}
                  </Link>
                  <Badge tone={o.pipeline === "project" ? "blue" : "neutral"}>{pipelineLabel(o.pipeline)} pipeline</Badge>
                  <Badge tone={o.stage_kind === "won" ? "green" : o.stage_kind === "lost" ? "red" : statusTone(o.status)}>{o.status}</Badge>
                  {o.potential && (
                    <Badge tone={potentialTone(o.potential)}>
                      {o.potential}
                      {o.potential_source === "ai" ? " (AI)" : ""}
                    </Badge>
                  )}
                  {o.interventions?.map((i) => (
                    <Badge key={i} tone="blue">
                      <Droplets size={10} /> {i}
                    </Badge>
                  ))}
                </div>
                <div className="text-xs text-[var(--text-3)] mt-0.5">
                  Customer:{" "}
                  <Link to={`/organizations/${o.organization_id}`} className="hover:underline text-[var(--text-2)]">
                    {o.organization_name}
                  </Link>
                  {o.stakeholder_roles?.length ? ` (${o.stakeholder_roles.join(", ")})` : ""} · {o.opportunity_type} · {o.owner_name ?? "Unassigned"} · last activity {relativeDays(o.last_activity_at)}
                  {o.next_task_title ? ` · next: ${o.next_task_title}` : ""}
                </div>
              </div>
              <Link to={`/crm/${o.id}`}>
                <Button size="sm">Open</Button>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ProjectCrmDialog projectId={d.project.id} projectName={d.project.name} stakeholders={d.stakeholders} open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}

/** Tasks for the project: on its project opportunities, and project tasks not tied to an opportunity. */
function ProjectTasks({ projectId, projectName }: { projectId: number; projectName: string }) {
  const { data, error } = useApi<Task[]>(`/tasks?project_id=${projectId}`);
  const [open, setOpen] = useState(false);
  return (
    <Card
      className="mt-6"
      icon={ListChecks}
      title="Project tasks"
      description="Follow-ups on this project's opportunities, and project tasks"
      actions={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus size={12} /> Add
        </Button>
      }
      bodyClassName="py-1"
    >
      <ErrorNote error={error} />
      {!data ? <Spinner /> : <TaskList tasks={data} emptyText="No tasks for this project" />}
      <TaskDialog open={open} onClose={() => setOpen(false)} projectId={projectId} contextLabel={`Project task: ${projectName} (not tied to a CRM opportunity)`} />
    </Card>
  );
}

function ActivityTab({ projectId }: { projectId: number }) {
  const { data, error } = useApi<(Activity & { key: string })[]>(`/projects/${projectId}/activity`);
  if (error) return <ErrorNote error={error} />;
  return (
    <Card title="Activity" description="Project changes, stakeholder links, facts and CRM activity on linked opportunities">
      {!data ? <Spinner /> : <Timeline activities={data.map((a, i) => ({ ...a, id: i + 1 }))} />}
    </Card>
  );
}

export default function ProjectDetails() {
  const { id } = useParams();
  const { catalog } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as TabKey) ? params.get("tab") : "overview") as TabKey;
  const { data, error } = useApi<Detail>(`/projects/${id}`);
  const [editing, setEditing] = useState(false);
  const projectDefs = useMemo(() => (catalog?.factDefinitions ?? []).filter((d) => d.applies_to === "project"), [catalog]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  if (data.merged_into) return <Navigate to={`/projects/${data.merged_into}`} replace />;
  const p = data.project;
  const liveWater = data.water_opportunities.filter(isLiveWater).length;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="min-w-0">
          <Link to="/projects" className="text-xs text-[var(--text-3)] hover:underline">
            ← Projects
          </Link>
          <h1 className="text-[22px] leading-7 font-semibold tracking-tight mt-1.5">{p.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge>{p.project_type ?? "Type unknown"}</Badge>
            <Badge tone={stageTone(p.lifecycle_stage)}>{p.lifecycle_stage === "Unknown" ? "Stage unknown" : p.lifecycle_stage}</Badge>
            {p.area && <Badge>{p.area}</Badge>}
            {p.scale !== "Unknown" && <Badge>{p.scale} scale</Badge>}
            <Badge tone={confidenceTone(p.data_confidence)}>Data confidence: {p.data_confidence}</Badge>
          </div>
        </div>
        <Button onClick={() => setEditing(true)}>
          <Pencil size={13} /> Edit project
        </Button>
      </div>

      <div className="mb-5 overflow-x-auto">
        <Tabs<TabKey>
          value={tab}
          onChange={(t) => setParams(t === "overview" ? {} : { tab: t }, { replace: true })}
          items={[
            { value: "overview", label: "Overview" },
            { value: "stakeholders", label: "Stakeholders", count: data.stakeholders.length },
            { value: "water", label: "Water Intelligence", count: data.facts.length },
            { value: "opportunities", label: "Opportunities", count: liveWater },
            { value: "crm", label: "CRM", count: data.crm_opportunities.length },
            { value: "activity", label: "Activity" },
          ]}
        />
      </div>

      {tab === "overview" && <Overview d={data} onEdit={() => setEditing(true)} />}
      {tab === "stakeholders" && <Stakeholders d={data} />}
      {tab === "water" && (
        <Card title="Water intelligence" description="Sourced water and sustainability facts about this project">
          <FactsPanel
            basePath={`/projects/${p.id}`}
            definitions={projectDefs}
            facts={data.facts}
            emptyTitle="No water information recorded yet."
            emptyHint="Add water demand, sources, existing systems or certifications as you learn them — each with its source."
          />
        </Card>
      )}
      {tab === "opportunities" && (
        <Card title="Water opportunities" description="Possible water interventions on this project, based on its recorded facts. Belongs to the project — not to each stakeholder.">
          <WaterOpportunitiesPanel
            items={data.water_opportunities}
            target={{ kind: "project", id: p.id, name: p.name }}
            stakeholders={data.stakeholders}
            crmOpportunities={data.crm_opportunities}
          />
        </Card>
      )}
      {tab === "crm" && (
        <>
          <Crm d={data} />
          <ProjectTasks projectId={p.id} projectName={p.name} />
        </>
      )}
      {tab === "activity" && <ActivityTab projectId={p.id} />}

      <ProjectForm open={editing} onClose={() => setEditing(false)} project={p} />
    </>
  );
}

