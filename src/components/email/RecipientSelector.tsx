import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Users } from "lucide-react";
import { CRM_STATUSES } from "../../../shared/constants";
import type { EligibleContactsPage } from "../../../shared/email";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { Badge, Button, cx, EmptyState, ErrorNote, Input, Select, Spinner, Tabs } from "../ui";
import { Pager } from "./emailUi";

const PAGE = 50;
const ENROLL_CHUNK = 500; // server accepts at most 500 contact ids per request

type Eligibility = "eligible" | "ineligible" | "all";

export interface EnrollResult {
  enrolled: number;
  skipped: { contact_id: number; reasons: string[] }[];
}

/** Enroll contacts through the existing enrollment endpoint (which re-checks eligibility on the server). */
export async function enrollSelected(campaignId: number, ids: number[]): Promise<EnrollResult> {
  const out: EnrollResult = { enrolled: 0, skipped: [] };
  for (let i = 0; i < ids.length; i += ENROLL_CHUNK) {
    const r = await api.post<EnrollResult>(`/email/campaigns/${campaignId}/enrollments`, { contact_ids: ids.slice(i, i + ENROLL_CHUNK) });
    out.enrolled += r.enrolled;
    out.skipped.push(...r.skipped);
  }
  return out;
}

export function enrollSummary(r: EnrollResult) {
  if (!r.skipped.length) return `${r.enrolled} recipient${r.enrolled === 1 ? "" : "s"} added`;
  const reasons = [...new Set(r.skipped.flatMap((s) => s.reasons))].slice(0, 2).join("; ");
  return `${r.enrolled} added, ${r.skipped.length} skipped after re-checking eligibility: ${reasons}`;
}

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Pick CRM contacts for a campaign. Selection is controlled by the parent; only eligible contacts can be selected.
 * Eligibility shown here is advisory — the server checks again on enrollment and before every send.
 */
export default function RecipientSelector({
  campaignId,
  selected,
  onChange,
  remaining,
}: {
  campaignId: number;
  selected: Set<number>;
  onChange: (s: Set<number>) => void;
  /** How many more recipients the campaign may take (EMAIL_MAX_RECIPIENTS_PER_CAMPAIGN − current audience). */
  remaining?: number | null;
}) {
  const [search, setSearch] = useState("");
  const [crmStatus, setCrmStatus] = useState("");
  const [eligibility, setEligibility] = useState<Eligibility>("eligible");
  const [offset, setOffset] = useState(0);
  const q = useDebounced(search.trim());
  useEffect(() => setOffset(0), [q, crmStatus, eligibility]);

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset), include_ids: "true" });
  if (q) params.set("search", q);
  if (crmStatus) params.set("crm_status", crmStatus);
  if (eligibility !== "all") params.set("eligibility", eligibility);
  const { data, error, loading, reload } = useApi<EligibleContactsPage>(`/email/campaigns/${campaignId}/eligible-contacts?${params}`);

  // Drop selections that are no longer eligible (e.g. suppressed or enrolled since they were picked).
  useEffect(() => {
    if (!data) return;
    const stale = data.items.filter((c) => !c.eligible && selected.has(c.contact_id));
    if (stale.length) {
      const n = new Set(selected);
      stale.forEach((c) => n.delete(c.contact_id));
      onChange(n);
    }
  }, [data]);

  const toggle = (id: number) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChange(n);
  };
  const pageEligible = (data?.items ?? []).filter((c) => c.eligible);
  const allPageSelected = pageEligible.length > 0 && pageEligible.every((c) => selected.has(c.contact_id));
  const allIds = data?.eligible_ids ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const hiddenSelected = data ? [...selected].filter((id) => !data.items.some((c) => c.contact_id === id)).length : 0;
  const overLimit = remaining != null && selected.size > remaining;
  const filtered = !!q || !!crmStatus;

  let body: React.ReactNode;
  if (error) {
    body = (
      <div className="py-6">
        <ErrorNote error={`Could not load CRM contacts: ${error}`} />
        <Button size="sm" onClick={reload}>
          <RefreshCw size={13} /> Try again
        </Button>
      </div>
    );
  } else if (!data) {
    body = <Spinner label="Loading CRM contacts…" />;
  } else if (data.crm_contacts === 0) {
    body = (
      <EmptyState compact icon={Users} title="No CRM contacts yet">
        Recipients come from contacts of organizations in the <Link to="/crm" className="text-[var(--accent)] hover:underline">CRM</Link>. Add an organization to the CRM and record a contact with an email address on its page.
      </EmptyState>
    );
  } else if (!data.items.length && eligibility === "eligible" && data.eligible_total === 0 && !filtered) {
    body = (
      <EmptyState compact icon={Users} title="No eligible contacts" action={<Button size="sm" onClick={() => setEligibility("ineligible")}>Show why ({data.ineligible_total})</Button>}>
        None of the {data.crm_contacts} CRM contacts can be added right now — for example they have no valid email, are suppressed, are already in this campaign, or their CRM stage stops outreach.
      </EmptyState>
    );
  } else if (!data.items.length) {
    body = <EmptyState compact title="No contacts match these filters">Try a different search or CRM stage.</EmptyState>;
  } else {
    body = (
      <div className={cx("overflow-x-auto", loading && "opacity-60")}>
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-xs text-[var(--text-3)]">
            <tr>
              <th className="py-2 w-8">
                <input
                  type="checkbox"
                  aria-label="Select all eligible contacts on this page"
                  disabled={!pageEligible.length}
                  checked={allPageSelected}
                  onChange={(e) => {
                    const n = new Set(selected);
                    pageEligible.forEach((c) => (e.target.checked ? n.add(c.contact_id) : n.delete(c.contact_id)));
                    onChange(n);
                  }}
                />
              </th>
              <th className="py-2 font-medium">Contact</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Organization</th>
              <th className="py-2 font-medium">CRM stage</th>
              <th className="py-2 font-medium">Eligibility</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {data.items.map((c) => (
              <tr key={c.contact_id} className={c.eligible ? "" : "text-[var(--text-3)]"}>
                <td className="py-2 align-top">
                  <input type="checkbox" disabled={!c.eligible} checked={selected.has(c.contact_id)} onChange={() => toggle(c.contact_id)} aria-label={`Select ${c.name}`} />
                </td>
                <td className="py-2 align-top">
                  <div className={c.eligible ? "font-medium text-[var(--text)]" : "font-medium"}>{c.name}</div>
                  <div className="text-xs text-[var(--text-3)]">{c.designation ?? "Designation unknown"}</div>
                </td>
                <td className="py-2 align-top break-all">{c.email ?? <span className="italic">No email</span>}</td>
                <td className="py-2 align-top">
                  <Link to={`/organizations/${c.organization_id}`} className="hover:text-[var(--accent-text)]">
                    {c.organization_name}
                  </Link>
                </td>
                <td className="py-2 align-top">{c.crm_status ? <Badge>{c.crm_status}</Badge> : "—"}</td>
                <td className="py-2 align-top text-xs max-w-[260px]">
                  {c.eligible ? (
                    <Badge tone="green" dot>
                      Eligible
                    </Badge>
                  ) : (
                    <>
                      <Badge tone="red" dot>
                        Not eligible
                      </Badge>
                      <ul className="mt-1 space-y-0.5">
                        {c.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager total={data.total} offset={offset} setOffset={setOffset} size={PAGE} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="!w-72" type="search" placeholder="Search name, email or organization…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search contacts" />
        <Select className="!w-44" value={crmStatus} onChange={(e) => setCrmStatus(e.target.value)} options={[...CRM_STATUSES]} placeholder="Any CRM stage" aria-label="CRM stage" />
        <Tabs
          value={eligibility}
          onChange={(v) => setEligibility(v as Eligibility)}
          items={[
            { value: "eligible", label: "Eligible", count: data?.eligible_total },
            { value: "ineligible", label: "Not eligible", count: data?.ineligible_total },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm" aria-live="polite">
        <b className="tabular-nums">{selected.size}</b> selected
        {hiddenSelected > 0 && <span className="text-xs text-[var(--text-3)]">({hiddenSelected} not shown with current filters)</span>}
        <span className="flex-1" />
        {allIds.length > 0 && !allSelected && (
          <Button size="sm" variant="ghost" onClick={() => onChange(new Set([...selected, ...allIds]))}>
            Select all {allIds.length} eligible{filtered ? " matching filters" : ""}
          </Button>
        )}
        {selected.size > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange(new Set())}>
            Clear selection
          </Button>
        )}
      </div>
      {overLimit && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
          This campaign can take {remaining} more recipient{remaining === 1 ? "" : "s"} (EMAIL_MAX_RECIPIENTS_PER_CAMPAIGN). Contacts beyond that will be skipped.
        </div>
      )}
      {body}
      <p className="text-[11px] text-[var(--text-3)]">Eligibility is checked again on the server when recipients are added and immediately before each email is sent.</p>
    </div>
  );
}
