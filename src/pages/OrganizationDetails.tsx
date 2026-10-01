import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Bot, Building2, ExternalLink, GitMerge, History, KanbanSquare, ListChecks, Pencil, PhoneCall, Plus, Search, Sparkles, Users } from "lucide-react";
import { CALL_STATUSES, CRM_STATUSES, PILOT_STATUSES, PROPOSAL_STATUSES } from "../../shared/constants";
import type { Activity, Contact, Opportunity, Organization, Recommendation, Task } from "../../shared/types";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { displayUrl, dueLabel, formatDate, relativeDays } from "../lib/format";
import { useApp } from "../context/AppContext";
import BengaluruMap from "../components/map/BengaluruMap";
import OrganizationForm from "../components/org/OrganizationForm";
import AddToCrmDialog from "../components/org/AddToCrmDialog";
import InteractionForm from "../components/org/InteractionForm";
import TaskDialog from "../components/org/TaskDialog";
import Timeline from "../components/org/Timeline";
import TaskList from "../components/TaskList";
import RecommendationList from "../components/RecommendationList";
import { Badge, Button, Card, confidenceTone, EmptyState, ErrorNote, Field, Input, Modal, PotentialBadge, ProvenanceTag, Select, Spinner, statusTone, Textarea } from "../components/ui";

interface Detail {
  merged_into?: number;
  organization: Organization;
  contacts: Contact[];
  activities: Activity[];
  tasks: Task[];
  opportunity: (Opportunity & { owner_name: string | null }) | null;
  suggestions: Recommendation[];
  recommendations: Recommendation[];
}

function InfoRow({ label, value, fs, children }: { label: string; value?: React.ReactNode; fs?: Organization["field_sources"][string]; children?: React.ReactNode }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-1.5 text-sm">
      <dt className="text-[var(--text-3)]">{label}</dt>
      <dd className="min-w-0 break-words flex flex-wrap items-center gap-1.5">
        {children ?? (empty ? <span className="text-[var(--text-3)]">Unknown</span> : value)}
        {!empty && fs && <ProvenanceTag fs={fs} />}
      </dd>
    </div>
  );
}

function CrmPanel({ opp, contacts }: { opp: Detail["opportunity"] & object; contacts: Contact[] }) {
  const { activeUsers, invalidate, toast } = useApp();
  const [notes, setNotes] = useState(opp.notes ?? "");
  useEffect(() => setNotes(opp.notes ?? ""), [opp.notes]);
  async function patch(body: object) {
    try {
      await api.patch(`/crm/${opp.id}`, body);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select value={opp.status} onChange={(e) => patch({ status: e.target.value })} options={CRM_STATUSES} />
        </Field>
        <Field label="Owner">
          <Select value={opp.owner_id ?? ""} onChange={(e) => patch({ owner_id: e.target.value ? Number(e.target.value) : null })} options={activeUsers.map((u) => ({ value: u.id, label: u.name }))} placeholder="Unassigned" />
        </Field>
        <Field label="Contact person">
          <Select value={opp.contact_id ?? ""} onChange={(e) => patch({ contact_id: e.target.value ? Number(e.target.value) : null })} options={contacts.map((c) => ({ value: c.id, label: c.name }))} placeholder={contacts.length ? "Not set" : "Add a contact below"} />
        </Field>
        <Field label="Call status">
          <Select value={opp.call_status} onChange={(e) => patch({ call_status: e.target.value })} options={CALL_STATUSES} />
        </Field>
        <Field label="Proposal status">
          <Select value={opp.proposal_status} onChange={(e) => patch({ proposal_status: e.target.value })} options={PROPOSAL_STATUSES} />
        </Field>
        <Field label="Pilot status">
          <Select value={opp.pilot_status} onChange={(e) => patch({ pilot_status: e.target.value })} options={PILOT_STATUSES} />
        </Field>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm rounded-md bg-[var(--surface-2)] px-3 py-2">
        <div>
          <dt className="text-xs text-[var(--text-3)]">Last contact</dt>
          <dd>{opp.last_contact_at ? formatDate(opp.last_contact_at) : "Never"}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-3)]">Last activity</dt>
          <dd>{relativeDays(opp.last_activity_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-3)]">Next follow-up</dt>
          <dd>{opp.next_follow_up ? dueLabel(opp.next_follow_up) : "None scheduled"}</dd>
        </div>
      </dl>
      <Field label="Notes">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (opp.notes ?? "") && patch({ notes })} />
      </Field>
    </div>
  );
}

function ContactsCard({ orgId, contacts }: { orgId: number; contacts: Contact[] }) {
  const { invalidate, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const [c, setC] = useState({ name: "", designation: "", phone: "", email: "", is_primary: false });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.post(`/organizations/${orgId}/contacts`, c);
      setAdding(false);
      setC({ name: "", designation: "", phone: "", email: "", is_primary: false });
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card
      icon={Users}
      title="Contacts"
      actions={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus size={12} /> Add
        </Button>
      }
    >
      {!contacts.length ? (
        <EmptyState title="No contact people yet" icon={Users} compact />
      ) : (
        <ul className="space-y-2">
          {contacts.map((ct) => (
            <li key={ct.id} className="text-sm">
              <div className="font-medium flex items-center gap-2">
                {ct.name} {ct.is_primary && <Badge tone="blue">Primary</Badge>}
              </div>
              <div className="text-xs text-[var(--text-3)]">{[ct.designation, ct.phone, ct.email].filter(Boolean).join(" · ") || "No details"}</div>
              {ct.source_label && <div className="text-[11px] text-[var(--text-3)]">Source: {ct.source_label}</div>}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add contact"
        footer={
          <Button variant="primary" loading={busy} onClick={save}>
            Save
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name *">
            <Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Designation">
            <Input value={c.designation} onChange={(e) => setC({ ...c, designation: e.target.value })} placeholder="e.g. Operations Manager" />
          </Field>
          <Field label="Phone">
            <Input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.is_primary} onChange={(e) => setC({ ...c, is_primary: e.target.checked })} /> Primary contact
          </label>
        </div>
      </Modal>
    </Card>
  );
}

function IntelligenceCard({ org, suggestions }: { org: Organization; suggestions: Recommendation[] }) {
  const { invalidate, toast, system } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [water, setWater] = useState({ text: "", provenance: "Verified", source: "" });
  const [addingWater, setAddingWater] = useState(false);
  const intel = org.intelligence ?? {};

  async function run(kind: "assess" | "enrich") {
    setBusy(kind);
    try {
      if (kind === "assess") await api.post(`/organizations/${org.id}/assess`);
      else {
        const r = await api.post<{ added: number; sourcesTried: string[] }>(`/organizations/${org.id}/enrich`);
        toast(r.sourcesTried.length ? `Checked ${r.sourcesTried.join(", ")} — ${r.added} new suggestion(s)` : "Nothing to check — add a website or address first");
      }
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }
  async function decide(id: number, decision: "accept" | "dismiss") {
    try {
      await api.post(`/organizations/${org.id}/suggestions/${id}/${decision}`);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }
  async function saveWater() {
    try {
      await api.post(`/organizations/${org.id}/water-info`, water);
      setWater({ text: "", provenance: "Verified", source: "" });
      setAddingWater(false);
      invalidate();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <Card
      icon={Sparkles}
      title="Intelligence"
      actions={
        <>
          <Button size="sm" loading={busy === "enrich"} onClick={() => run("enrich")} title={`Enrichment agent: look up public information (website, geocoder${system?.llm ? ", AI web research" : ""})`}>
            <Search size={12} /> Find public info
          </Button>
          <Button size="sm" loading={busy === "assess"} onClick={() => run("assess")} title="Opportunity agent">
            <Bot size={12} /> Re-assess
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <PotentialBadge potential={intel.potential} />
        <Badge tone={confidenceTone(intel.confidence)}>Assessment confidence: {intel.confidence ?? "Unknown"}</Badge>
        <Badge tone="purple">AI Inference</Badge>
      </div>
      {intel.reasons?.length ? (
        <ul className="list-disc ml-5 text-sm text-[var(--text-2)] space-y-0.5">
          {intel.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--text-3)]">Not assessed yet.</p>
      )}
      {intel.assessedAt && <p className="text-[11px] text-[var(--text-3)] mt-1">Opportunity agent · {formatDate(intel.assessedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>}

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">Water-related information</h3>
          <button onClick={() => setAddingWater((v) => !v)} className="text-xs text-[var(--accent)] hover:underline cursor-pointer">
            {addingWater ? "Cancel" : "Add"}
          </button>
        </div>
        {addingWater && (
          <div className="mt-2 space-y-2 rounded-md border border-[var(--border)] p-3">
            <Textarea value={water.text} onChange={(e) => setWater({ ...water, text: e.target.value })} placeholder="e.g. Uses 2 borewells and ~20 tankers/month (told by facility manager)" />
            <div className="grid grid-cols-2 gap-2">
              <Select value={water.provenance} onChange={(e) => setWater({ ...water, provenance: e.target.value })} options={["Verified", "Unverified", "Estimated"]} />
              <Input value={water.source} onChange={(e) => setWater({ ...water, source: e.target.value })} placeholder="Source (person, URL, document)" />
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="primary" onClick={saveWater} disabled={!water.text.trim()}>
                Save
              </Button>
            </div>
          </div>
        )}
        {intel.waterInfo?.length ? (
          <ul className="mt-2 space-y-1.5">
            {intel.waterInfo.map((w, i) => (
              <li key={i} className="text-sm">
                {w.text} <ProvenanceTag fs={{ provenance: w.provenance, source: w.source }} />
                {w.source && <div className="text-[11px] text-[var(--text-3)] break-all">Source: {w.source}</div>}
              </li>
            ))}
          </ul>
        ) : (
          !addingWater && <p className="text-sm text-[var(--text-3)] mt-1">Unknown</p>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-3)] mb-2">Suggestions from the enrichment agent</h3>
          <ul className="space-y-2">
            {suggestions.map((s) => {
              const p = s.payload as { field: string; value: string | { lat: number; lng: number }; source: string; provenance: string; note?: string };
              return (
                <li key={s.id} className="rounded-md border border-[var(--border)] p-2.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[var(--text-3)]">{p.field.replace("_", " ")}: </span>
                      <span className="font-medium break-words">{typeof p.value === "string" ? p.value : `${p.value.lat.toFixed(5)}, ${p.value.lng.toFixed(5)}`}</span>{" "}
                      <ProvenanceTag fs={{ provenance: p.provenance as never, source: p.source }} />
                      <div className="text-[11px] text-[var(--text-3)] break-all mt-0.5">
                        {p.note} · Source: {/^https?:/.test(p.source) ? <a href={p.source} target="_blank" rel="noreferrer" className="underline">{p.source}</a> : p.source}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="primary" onClick={() => decide(s.id, "accept")}>
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => decide(s.id, "dismiss")}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

function MergeDialog({ org, open, onClose }: { org: Organization; open: boolean; onClose: () => void }) {
  const { invalidate, toast } = useApp();
  const { data: orgs } = useApi<Organization[]>(open ? "/organizations" : null);
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => (orgs ?? []).filter((o) => o.id !== org.id && o.name.toLowerCase().includes(q.toLowerCase())).slice(0, 8), [orgs, q, org.id]);
  async function merge() {
    if (!target) return;
    setBusy(true);
    try {
      await api.post(`/organizations/${org.id}/merge-into/${target}`);
      toast("Records merged");
      invalidate();
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Merge into another record"
      footer={
        <Button variant="danger" loading={busy} disabled={!target} onClick={merge}>
          Merge {org.name} into selected
        </Button>
      }
    >
      <p className="text-sm text-[var(--text-2)] mb-3">
        Use this when the same organization exists twice. Contacts, timeline, tasks and CRM data move to the selected record; missing fields are filled in. This record is then hidden.
      </p>
      <Input placeholder="Search organization…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="mt-2 space-y-1">
        {matches.map((o) => (
          <li key={o.id}>
            <label className="flex items-center gap-2 text-sm rounded px-2 py-1.5 hover:bg-[var(--surface-2)] cursor-pointer">
              <input type="radio" checked={target === o.id} onChange={() => setTarget(o.id)} />
              <span>{o.name}</span>
              <span className="text-xs text-[var(--text-3)]">{o.area}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export default function OrganizationDetails() {
  const { id } = useParams();
  const { data, error } = useApi<Detail>(`/organizations/${id}`);
  const [editing, setEditing] = useState(false);
  const [crmOpen, setCrmOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner />;
  if (data.merged_into) return <Navigate to={`/organizations/${data.merged_into}`} replace />;
  const { organization: o, contacts, activities, tasks, opportunity, suggestions, recommendations } = data;
  const fs = o.field_sources ?? {};

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <Link to="/organizations" className="text-xs text-[var(--text-3)] hover:underline">
            ← Organizations
          </Link>
          <h1 className="text-[22px] leading-7 font-semibold tracking-tight mt-1.5">{o.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge>{o.org_type}</Badge>
            <PotentialBadge potential={o.intelligence?.potential} />
            <Badge tone={confidenceTone(o.data_confidence)} title="How complete and verified this record is">
              Data confidence: {o.data_confidence}
            </Badge>
            {opportunity ? <Badge tone={statusTone(opportunity.status)}>CRM: {opportunity.status}</Badge> : <Badge>Not in CRM</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing(true)}>
            <Pencil size={13} /> Edit
          </Button>
          <Button variant="ghost" onClick={() => setMergeOpen(true)}>
            <GitMerge size={14} /> Merge duplicate
          </Button>
          {!opportunity && (
            <Button variant="primary" onClick={() => setCrmOpen(true)}>
              Add to CRM
            </Button>
          )}
        </div>
      </div>

      {recommendations.length > 0 && (
        <Card icon={Bot} title="AI recommendation" className="mb-6">
          <RecommendationList items={recommendations} />
        </Card>
      )}

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 items-start">
        <div className="space-y-6">
          <Card icon={Building2} title="Basic information">
            <dl className="divide-y divide-[var(--border)]">
              <InfoRow label="Name" value={o.name} fs={fs.name} />
              <InfoRow label="Type" value={o.org_type === "Other" && fs.org_type?.provenance === "Unknown" ? null : o.org_type} fs={fs.org_type} />
              <InfoRow label="Sector" value={o.sector} fs={fs.sector} />
              <InfoRow label="Address" value={o.address} fs={fs.address} />
              <InfoRow label="Area" value={o.area} fs={fs.area} />
              <InfoRow label="Pincode" value={o.pincode} fs={fs.pincode} />
              <InfoRow label="Phone" value={o.phone && <a href={`tel:${o.phone.replace(/\s/g, "")}`}>{o.phone}</a>} fs={fs.phone} />
              <InfoRow label="Email" value={o.email && <a href={`mailto:${o.email}`}>{o.email}</a>} fs={fs.email} />
              <InfoRow
                label="Website"
                value={
                  o.website && (
                    <a href={o.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)] hover:underline">
                      {displayUrl(o.website)} <ExternalLink size={11} />
                    </a>
                  )
                }
                fs={fs.website}
              />
              <InfoRow label="Location" value={o.lat != null ? `${o.lat.toFixed(5)}, ${o.lng!.toFixed(5)}` : null} fs={fs.location} />
              <InfoRow label="Source" value={o.source_label} />
            </dl>
            {o.lat != null && (
              <div className="h-56 mt-4 rounded-lg overflow-hidden border border-[var(--border)]">
                <BengaluruMap organizations={[o]} focusId={o.id} className="h-full w-full" scrollWheelZoom={false} openFocusPopup={false} />
              </div>
            )}
          </Card>
          <IntelligenceCard org={o} suggestions={suggestions} />
        </div>

        <div className="space-y-6">
          <Card icon={KanbanSquare} title="CRM">
            {opportunity ? (
              <CrmPanel opp={opportunity} contacts={contacts} />
            ) : (
              <div className="text-sm text-[var(--text-2)]">
                This organization is in the discovery database but not in the CRM.
                <div className="mt-3">
                  <Button variant="primary" onClick={() => setCrmOpen(true)}>
                    Add to CRM
                  </Button>
                </div>
              </div>
            )}
          </Card>
          {opportunity && (
            <Card icon={PhoneCall} title="Record interaction" description="Contact attempts, calls, proposals and notes">
              <InteractionForm opportunityId={opportunity.id} ownerId={opportunity.owner_id} />
            </Card>
          )}
          <ContactsCard orgId={o.id} contacts={contacts} />
          <Card
            icon={ListChecks}
            title="Follow-ups"
            actions={
              <Button size="sm" onClick={() => setTaskOpen(true)}>
                <Plus size={12} /> Add
              </Button>
            }
            bodyClassName="py-1"
          >
            <TaskList tasks={tasks} showOrg={false} />
          </Card>
          <Card icon={History} title="Activity timeline">
            <Timeline activities={activities} />
          </Card>
        </div>
      </div>

      <OrganizationForm open={editing} onClose={() => setEditing(false)} organization={o} />
      <AddToCrmDialog org={crmOpen ? o : null} onClose={() => setCrmOpen(false)} stayOnPage />
      <TaskDialog open={taskOpen} onClose={() => setTaskOpen(false)} organizationId={o.id} />
      <MergeDialog org={o} open={mergeOpen} onClose={() => setMergeOpen(false)} />
    </>
  );
}
