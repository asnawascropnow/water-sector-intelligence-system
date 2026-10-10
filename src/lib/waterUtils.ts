import type { WaterOpportunityStatus } from "../../shared/constants";
import type { EvidenceRef, WaterOpportunity } from "../../shared/types";

/** Panel sections, in display order. Rejected / closed items are always listed (audit), never hidden. */
export const WATER_SECTIONS = [
  { key: "suggestions", title: "AI suggestions", statuses: ["suggested"], hint: "Hypotheses from recorded facts (AI Inference). Not trusted until a person approves them." },
  { key: "review", title: "Needs review", statuses: ["needs_review"], hint: "Someone is checking the evidence." },
  { key: "approved", title: "Approved opportunities", statuses: ["approved", "converted"], hint: "Approved by a named person — trusted water opportunities." },
  { key: "closed", title: "Rejected / closed", statuses: ["rejected", "closed"], hint: "Kept with the reason, for the audit trail." },
] as const satisfies readonly { key: string; title: string; statuses: readonly WaterOpportunityStatus[]; hint: string }[];

export type WaterSectionKey = (typeof WATER_SECTIONS)[number]["key"];

export function groupWaterOpportunities(items: WaterOpportunity[]): Record<WaterSectionKey, WaterOpportunity[]> {
  const out = { suggestions: [], review: [], approved: [], closed: [] } as Record<WaterSectionKey, WaterOpportunity[]>;
  for (const w of items) {
    const s = WATER_SECTIONS.find((x) => (x.statuses as readonly string[]).includes(w.status));
    out[s?.key ?? "closed"].push(w);
  }
  return out;
}

export const isLiveWater = (w: { status: string }) => w.status !== "rejected" && w.status !== "closed";
/** Trusted = approved by a person (including those already converted to CRM). */
export const isTrustedWater = (w: { status: string }) => w.status === "approved" || w.status === "converted";

export const WATER_STATUS_LABEL: Record<WaterOpportunityStatus, { label: string; tone: "amber" | "green" | "red" | "blue" | "neutral" | "purple" }> = {
  suggested: { label: "AI suggestion — awaiting review", tone: "amber" },
  needs_review: { label: "Needs review", tone: "blue" },
  approved: { label: "Approved", tone: "green" },
  converted: { label: "In CRM", tone: "purple" },
  rejected: { label: "Rejected", tone: "red" },
  closed: { label: "Closed", tone: "neutral" },
};

export const OUTCOME_LABEL: Record<string, string> = { won: "Won", lost: "Lost", not_pursued: "Not pursued", superseded: "Superseded", other: "Other" };

export type WaterAction = "start_review" | "approve" | "reject" | "convert" | "assign" | "close" | "reconsider" | "reopen";

/** Which actions a person can take on an opportunity in each status (mirrors the API's transitions). */
export function waterActions(status: WaterOpportunityStatus): WaterAction[] {
  switch (status) {
    case "suggested":
      return ["start_review", "approve", "reject", "assign"];
    case "needs_review":
      return ["approve", "reject", "assign"];
    case "approved":
      return ["convert", "assign", "close"];
    case "converted":
      return ["assign", "close"];
    case "rejected":
      return ["reconsider"];
    case "closed":
      return ["reopen"];
  }
}

/** "Label: value" for an evidence chip — the value exactly as recorded. */
export function evidenceLabel(r: EvidenceRef): string {
  return r.kind === "water_info" ? `“${r.value}”` : `${r.label}: ${r.value}`;
}

/** Short summary of a generate run for a toast. */
export function generateSummary(r: { created: number; refreshed: number; unchanged: number; kept: number; skipped_rejected: number; stale: number }): string {
  const parts: string[] = [];
  if (r.created) parts.push(`${r.created} new suggestion${r.created === 1 ? "" : "s"}`);
  if (r.refreshed) parts.push(`${r.refreshed} refreshed`);
  if (r.stale) parts.push(`${r.stale} no longer supported by the facts`);
  if (!parts.length) {
    const seen = r.unchanged + r.kept + r.skipped_rejected;
    return seen ? "No new opportunities — existing ones are up to date" : "No opportunities found: the recorded facts are not enough evidence for any intervention yet";
  }
  return parts.join(", ");
}
