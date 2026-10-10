import { createHash } from "node:crypto";
import type { Queryable } from "../db";
import type { DataConfidence, Potential, Provenance } from "../../shared/constants";
import type { EvidenceRef, Fact, FieldSource, WaterInfo } from "../../shared/types";

/**
 * Agent 3 (extension) — Water Opportunity rules.
 *
 * The Opportunity Agent rates organizations (opportunity.ts). This extension reads the sourced facts on a
 * project or organization and proposes specific water interventions as *hypotheses*:
 *  - every suggestion names the exact evidence (fact / field / water note, with its provenance and source)
 *    that triggered it, and says what is *not* evidenced ("no sourced evidence of …") rather than claiming
 *    a requirement;
 *  - if the evidence is insufficient, no suggestion is made — nothing is guessed or filled in;
 *  - AI-inferred facts are never used as triggers (inference on inference);
 *  - project suggestions stay on the project: stakeholders do not inherit them;
 *  - output is labelled AI Inference and must be approved by a person (see lib/waterOpportunities.ts).
 * The functions below are pure; lib/waterOpportunities.ts applies their output with de-duplication.
 */

export const WATER_AGENT = "water_opportunity_rules";

export interface WaterDraft {
  rule_key: string;
  intervention: string;
  context_key: string;
  potential: Potential;
  confidence: DataConfidence;
  reason: string;
  evidence_refs: EvidenceRef[];
}

/* ------------------------------------------------------------------ evidence helpers */

const TRUSTED: Provenance[] = ["Verified", "Unverified", "Estimated"];
const usable = (f: { provenance: string }) => TRUSTED.includes(f.provenance as Provenance);

function factRef(entity: EvidenceRef["entity"], entityId: number, f: Fact, unit?: string | null): EvidenceRef {
  return {
    kind: "fact",
    entity,
    entity_id: entityId,
    fact_id: f.id,
    key: f.fact_key,
    label: f.label,
    value: unit ? `${f.value} ${unit}` : f.value,
    provenance: f.provenance,
    source: f.source,
    confidence: f.confidence,
  };
}

function fieldRef(entity: EvidenceRef["entity"], entityId: number, key: string, label: string, value: unknown, fs?: FieldSource): EvidenceRef {
  return {
    kind: "field",
    entity,
    entity_id: entityId,
    key,
    label,
    value: typeof value === "number" ? value.toLocaleString("en-IN") : String(value),
    provenance: fs?.provenance && fs.provenance !== "Unknown" ? fs.provenance : "Unverified",
    source: fs?.source ?? null,
  };
}

/** "Label: value (Provenance, source: …)" — how evidence is quoted inside a reason. */
export function describeEvidence(r: EvidenceRef): string {
  const value = r.kind === "water_info" ? `“${r.value}”` : r.value;
  return `${r.label}: ${value} (${r.provenance}${r.source ? `, source: ${r.source}` : ""})`;
}
const quote = (refs: EvidenceRef[]) => refs.map(describeEvidence).join("; ");

/** Stable digest of the evidence used, so a refreshed run can tell whether anything changed. */
export function evidenceSignature(refs: EvidenceRef[]): string {
  const parts = refs.map((r) => `${r.kind}:${r.entity}:${r.entity_id}:${r.fact_id ?? r.key}=${r.value.toLowerCase()}`).sort();
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

/**
 * Confidence of a suggestion from its *triggering* evidence: all Verified → High; any Unverified or
 * Estimated → Medium; free-text matches cap at Medium; an inferred organization type caps at Low.
 */
export function confidenceFor(triggers: EvidenceRef[], opts: { textual?: boolean; inferredContext?: boolean } = {}): DataConfidence {
  if (!triggers.length) return "Unknown";
  let c: DataConfidence = triggers.every((t) => t.provenance === "Verified") ? "High" : "Medium";
  if (triggers.some((t) => t.provenance === "AI Inference")) c = "Low";
  if (opts.textual && c === "High") c = "Medium";
  if (opts.inferredContext) c = "Low";
  return c;
}

const level = (score: number): Potential => (score >= 3 ? "High" : score >= 2 ? "Medium" : "Low");

const NEGATION = /\b(no|not|without|lacks?|lacking|absent|missing|none|never|doesn'?t have|does not have|isn'?t|is not)\b[^.,;:]*$/i;

/** Does the text mention the term, and is the mention negated ("no STP", "does not have a borewell")? */
export function textMention(text: string, term: RegExp): "present" | "absent" | null {
  const m = term.exec(text);
  if (!m) return null;
  const before = text.slice(Math.max(0, m.index - 40), m.index);
  return NEGATION.test(before) ? "absent" : "present";
}

const TERMS = {
  stp: /\b(stp|sewage treatment( plant)?)s?\b/i,
  etp: /\b(etp|effluent( treatment)?|zld|zero liquid discharge)\b/i,
  reuse: /\b(recycl\w*|reus\w*|treated water for (flushing|gardening|landscaping))\b/i,
  groundwater: /\b(borewells?|bore wells?|groundwater|ground water)\b/i,
  tanker: /\b(tankers?)\b/i,
  rwh: /\b(rainwater harvesting|rwh)\b/i,
  leak: /\b(leak\w*|water loss(es)?|non-revenue water)\b/i,
  demand: /\b\d[\d,.]*\s?(kld|kl\/day|mld|litres? per day|liters? per day)\b/i,
};

/* ------------------------------------------------------------------ projects */

export interface ProjectContext {
  project: {
    id: number;
    name: string;
    project_type: string | null;
    lifecycle_stage: string;
    scale: string;
    built_up_area_sqft: number | null;
    building_count: number | null;
    unit_count: number | null;
    field_sources: Record<string, FieldSource>;
  };
  /** Active (current-version) project facts. */
  facts: Fact[];
  /** fact_key → unit from fact_definitions. */
  units?: Record<string, string | null>;
}

const WASTEWATER_TYPES = ["Residential", "Commercial", "Mixed-use", "Township", "Institutional", "Hospitality", "Healthcare", "Education", "Industrial", "Government"];
const REUSE_CONTEXT_TYPES = ["Hospitality", "Healthcare", "Industrial", "Institutional", "Education", "Township"];
const GREYWATER_TYPES = ["Residential", "Hospitality", "Institutional", "Education", "Township", "Mixed-use"];
const EARLY = ["Concept", "Design", "Approval", "Tender"];
const OPERATING = ["Commissioning", "Completed", "Operations"];

const LARGE_UNITS = 100;
const LARGE_AREA_SQFT = 100_000;
const HIGH_DEMAND_KLD = 100;

export function evaluateProject(ctx: ProjectContext): WaterDraft[] {
  const p = ctx.project;
  const facts = ctx.facts.filter(usable);
  const unit = (k: string) => ctx.units?.[k] ?? null;
  const ref = (f: Fact) => factRef("project", p.id, f, unit(f.fact_key));
  const field = (key: string, label: string, value: unknown) => fieldRef("project", p.id, key, label, value, p.field_sources?.[key]);
  const all = (key: string) => facts.filter((f) => f.fact_key === key);
  const withValue = (key: string, value: string) => facts.filter((f) => f.fact_key === key && f.value.toLowerCase() === value.toLowerCase());
  const num = (key: string) => {
    const f = all(key)[0];
    return f && Number.isFinite(Number(f.value)) ? { fact: f, n: Number(f.value) } : null;
  };
  const system = (name: string) => withValue("project_water_systems", name);
  const texts = [...all("water_notes"), ...all("sustainability_objectives"), ...all("green_certification")];
  const textHits = (term: RegExp, keys = ["water_notes"]) => texts.filter((f) => keys.includes(f.fact_key) && textMention(f.value, term) === "present");

  // Context
  const typeRef = p.project_type ? field("project_type", "Project type", p.project_type) : null;
  const stage = p.lifecycle_stage;
  const stageRef = stage !== "Unknown" ? field("lifecycle_stage", "Lifecycle stage", stage) : null;
  const early = EARLY.includes(stage);
  const operating = OPERATING.includes(stage);
  const demand = num("water_requirement");
  const wastewater = num("wastewater_generation");

  const large: EvidenceRef[] = [];
  if (p.scale === "Large" || p.scale === "Very large") large.push(field("scale", "Scale", p.scale));
  if (p.unit_count != null && p.unit_count >= LARGE_UNITS) large.push(field("unit_count", "Units", p.unit_count));
  if (p.built_up_area_sqft != null && Number(p.built_up_area_sqft) >= LARGE_AREA_SQFT) large.push(field("built_up_area_sqft", "Built-up area (sq ft)", Number(p.built_up_area_sqft)));
  if (demand && demand.n >= HIGH_DEMAND_KLD) large.push(ref(demand.fact));
  const veryLarge = p.scale === "Very large" || (p.unit_count ?? 0) >= 500 || Number(p.built_up_area_sqft ?? 0) >= 500_000;
  const sustainability = [...all("sustainability_objectives"), ...all("green_certification")].map(ref);

  const kind = p.project_type ? `${/^[aeiou]/i.test(p.project_type) ? "an" : "a"} ${p.project_type}` : "a";
  const scaleText = large.length ? `Project is ${kind} development with evidence of large scale (${quote(large)})` : `Project is ${kind} development`;
  const stageNote = early ? ` It is at the ${stage} stage, when systems can still be designed in.` : operating ? ` It is at the ${stage} stage, so this would be a retrofit.` : "";
  const ctxRefs = (...extra: (EvidenceRef | null)[]) => extra.filter((x): x is EvidenceRef => Boolean(x));
  const drafts: WaterDraft[] = [];
  const add = (d: Omit<WaterDraft, "context_key">) => drafts.push({ ...d, context_key: "" });

  // Rainwater harvesting: large site, no RWH evidenced.
  if (large.length && !system("Rainwater Harvesting").length && !withValue("water_sources", "Rainwater").length) {
    const score = 2 + (early ? 1 : 0) + (sustainability.length ? 1 : 0) - (operating ? 1 : 0);
    add({
      rule_key: "project.rainwater_harvesting",
      intervention: "Rainwater Harvesting",
      potential: level(score),
      confidence: confidenceFor(large),
      reason: `${scaleText}, and there is no sourced evidence of rainwater harvesting on it.${stageNote} Rainwater harvesting may be worth investigating.`,
      evidence_refs: [...large, ...ctxRefs(typeRef, stageRef), ...sustainability],
    });
  }

  // STP / wastewater treatment: wastewater generation, or a large wastewater-producing development, with no STP evidenced.
  const stpEvidence = [...system("STP"), ...all("stp_capacity")];
  const wwType = Boolean(p.project_type && WASTEWATER_TYPES.includes(p.project_type));
  if (!stpEvidence.length && (wastewater || (wwType && large.length))) {
    const industrial = p.project_type === "Industrial";
    const intervention = industrial ? "Wastewater Treatment" : "STP";
    const triggers = wastewater ? [ref(wastewater.fact), ...large] : large;
    const score = 2 + (wastewater && wastewater.n >= 50 ? 1 : 0) + (veryLarge ? 1 : 0) + (early ? 0.5 : 0);
    add({
      rule_key: industrial ? "project.wastewater_treatment" : "project.stp",
      intervention,
      potential: level(score),
      confidence: confidenceFor(triggers),
      reason:
        `${scaleText}${wastewater ? ` and has sourced evidence of wastewater generation (${describeEvidence(ref(wastewater.fact))})` : ""}, ` +
        `but there is no sourced evidence of ${industrial ? "wastewater (effluent) treatment" : "an STP"}.${stageNote} ${industrial ? "Wastewater treatment" : "An STP"} may be worth investigating.`,
      evidence_refs: [...triggers, ...ctxRefs(typeRef, stageRef)],
    });
  }

  // Sewage reuse: an STP is evidenced but reuse is not, on a large or reuse-relevant development.
  const reuseEvidence = [...system("Wastewater Reuse"), ...system("Water Recycling"), ...withValue("water_sources", "Recycled Water"), ...textHits(TERMS.reuse)];
  const reuseContext = large.length > 0 || Boolean(p.project_type && REUSE_CONTEXT_TYPES.includes(p.project_type));
  if (stpEvidence.length && !reuseEvidence.length && reuseContext) {
    const stress = [...withValue("water_sources", "Tanker"), ...withValue("water_sources", "Groundwater")].map(ref);
    const triggers = stpEvidence.map(ref);
    add({
      rule_key: "project.sewage_reuse",
      intervention: "Sewage Reuse",
      potential: level(2 + (large.length ? 0.5 : 0) + (stress.length ? 1 : 0)),
      confidence: confidenceFor(triggers),
      reason:
        `${scaleText} and has sourced evidence of an STP (${quote(triggers)}), but no sourced evidence of wastewater reuse.` +
        `${stress.length ? ` It also relies on ${stress.map((s) => s.value.toLowerCase()).join(" and ")} supply (${quote(stress)}).` : ""} Wastewater reuse may therefore be worth investigating.`,
      evidence_refs: [...triggers, ...large, ...ctxRefs(typeRef), ...stress],
    });
  }

  // Greywater reuse: residential / hospitality / institutional development with water-demand or water-efficiency evidence.
  if (p.project_type && GREYWATER_TYPES.includes(p.project_type) && (demand || sustainability.length) && !system("Greywater Reuse").length) {
    const triggers = [...(demand ? [ref(demand.fact)] : []), ...sustainability];
    add({
      rule_key: "project.greywater_reuse",
      intervention: "Greywater Reuse",
      potential: level(1.5 + (demand && demand.n >= HIGH_DEMAND_KLD ? 1 : 0) + (sustainability.length ? 0.5 : 0) + (early ? 0.5 : 0)),
      confidence: confidenceFor(triggers),
      reason:
        `Project is ${kind} development with sourced ${demand ? "water-demand" : "sustainability"} evidence (${quote(triggers)}) and no sourced evidence of greywater reuse.${stageNote} ` +
        `Greywater reuse may be worth investigating.`,
      evidence_refs: [...triggers, ...ctxRefs(typeRef, stageRef)],
    });
  }

  // Groundwater management: groundwater / borewell use evidenced.
  const groundwater = [...withValue("water_sources", "Groundwater"), ...textHits(TERMS.groundwater)].map(ref);
  if (groundwater.length) {
    add({
      rule_key: "project.groundwater_management",
      intervention: "Groundwater Management",
      potential: level(2 + (large.length ? 1 : 0)),
      confidence: confidenceFor(groundwater, { textual: groundwater.every((g) => g.key === "water_notes") }),
      reason: `There is sourced evidence that the project uses groundwater (${quote(groundwater)}). Groundwater monitoring and recharge may be worth investigating.`,
      evidence_refs: [...groundwater, ...large],
    });
  }

  // Alternative water supply: tanker dependence evidenced.
  const tanker = [...withValue("water_sources", "Tanker"), ...textHits(TERMS.tanker)].map(ref);
  if (tanker.length) {
    add({
      rule_key: "project.alternative_water_supply",
      intervention: "Alternative Water Supply",
      potential: level(2 + (large.length ? 1 : 0)),
      confidence: confidenceFor(tanker, { textual: tanker.every((g) => g.key === "water_notes") }),
      reason: `There is sourced evidence that the project depends on tanker water (${quote(tanker)}). Reducing tanker dependence (recycled water, rainwater, other supply) may be worth investigating.`,
      evidence_refs: [...tanker, ...large],
    });
  }

  // Smart water monitoring: large project with measured demand or in operation, no monitoring evidenced.
  if (large.length && (demand || operating) && !system("Smart Water Monitoring").length) {
    const triggers = [...large, ...(demand && !large.some((l) => l.fact_id === demand.fact.id) ? [ref(demand.fact)] : [])];
    add({
      rule_key: "project.smart_water_monitoring",
      intervention: "Smart Water Monitoring",
      potential: level(1.5 + (veryLarge ? 1 : 0) + (operating ? 0.5 : 0)),
      confidence: confidenceFor(triggers),
      reason: `${scaleText}${operating ? ` and is at the ${stage} stage` : ""}, with no sourced evidence of water metering or monitoring. Smart water monitoring may be worth investigating.`,
      evidence_refs: [...triggers, ...ctxRefs(stageRef)],
    });
  }

  // Leak detection: losses / leaks mentioned in sourced notes.
  const leaks = textHits(TERMS.leak).map(ref);
  if (leaks.length && !system("Leak Detection").length) {
    add({
      rule_key: "project.leak_detection",
      intervention: "Leak Detection",
      potential: level(2 + (large.length ? 0.5 : 0)),
      confidence: confidenceFor(leaks, { textual: true }),
      reason: `Sourced notes mention leaks or water losses on the project (${quote(leaks)}). Leak detection may be worth investigating.`,
      evidence_refs: [...leaks, ...large],
    });
  }

  // Water efficiency: high demand, or sustainability goals on a large project.
  const highDemand = demand && demand.n >= HIGH_DEMAND_KLD ? [ref(demand.fact)] : [];
  if ((highDemand.length || (sustainability.length && large.length)) && !system("Water-efficient Fixtures").length) {
    const triggers = highDemand.length ? [...highDemand, ...sustainability] : [...sustainability, ...large];
    add({
      rule_key: "project.water_efficiency",
      intervention: "Water Efficiency",
      potential: level(1.5 + (highDemand.length ? 1 : 0) + (sustainability.length ? 0.5 : 0) + (early ? 0.5 : 0)),
      confidence: confidenceFor(triggers),
      reason:
        `${highDemand.length ? `Project has sourced evidence of high water demand (${quote(highDemand)})` : `${scaleText} and has sourced sustainability goals (${quote(sustainability)})`}` +
        `, with no sourced evidence of water-efficient fixtures.${stageNote} Water-efficiency measures may be worth investigating.`,
      evidence_refs: [...triggers, ...ctxRefs(typeRef, stageRef)],
    });
  }

  return drafts.map((d) => ({ ...d, evidence_refs: dedupeRefs(d.evidence_refs) }));
}

function dedupeRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => {
    const k = `${r.kind}:${r.entity}:${r.fact_id ?? r.key}:${r.value}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------------------------------------------------ organizations */

export interface OrganizationContext {
  organization: {
    id: number;
    name: string;
    org_type: string;
    /** organization_type_groups.key of the type */
    group: string | null;
    field_sources: Record<string, FieldSource>;
    water_info: WaterInfo[];
  };
  facts: Fact[];
  /** Saved Discover views the organization's type belongs to (architects, developers, contractors…). */
  views: string[];
  /** Projects on which the organization is Developer or Owner. */
  developerProjects: { project_id: number; project_name: string; role: string; provenance: Provenance; source: string | null }[];
  /** Open relationship-pipeline CRM opportunity, if any — used to word the reason, not to decide. */
  crmRelationship: { id: number; status: string } | null;
}

/** Organization types whose own facilities use water (demand side). Water-ecosystem vendors and the built
 * environment (whose water context is their projects) are excluded from facility-level rules. */
const FACILITY_GROUPS = ["demand_side", "public_sector", "research_education", "civil_society"];

export function evaluateOrganization(ctx: OrganizationContext): WaterDraft[] {
  const o = ctx.organization;
  const facts = ctx.facts.filter(usable);
  const ref = (f: Fact) => factRef("organization", o.id, f);
  const yes = (key: string) => facts.filter((f) => f.fact_key === key && f.value === "Yes").map(ref);
  const all = (key: string) => facts.filter((f) => f.fact_key === key).map(ref);
  const typeInferred = o.field_sources?.org_type?.provenance === "AI Inference";
  const typeRef = fieldRef("organization", o.id, "org_type", "Organization type", o.org_type, o.field_sources?.org_type);
  const typeLabel = `${o.org_type}${typeInferred ? " (type inferred from name)" : ""}`;
  const crmNote = ctx.crmRelationship ? ` The organization is already in the CRM (${ctx.crmRelationship.status}); this could be raised within that relationship.` : "";
  const drafts: WaterDraft[] = [];
  const add = (d: Omit<WaterDraft, "context_key">) => drafts.push({ ...d, context_key: "" });

  // Architect: water-conscious design work + influence over water decisions → specification channel.
  if (ctx.views.includes("architects")) {
    const influence = facts.filter((f) => f.fact_key === "influence_level" && (f.value === "High" || f.value === "Medium")).map(ref);
    const design = [
      ...yes("water_conservation_experience"), ...yes("water_efficient_design"), ...yes("greywater_experience"),
      ...yes("wastewater_reuse_experience"), ...yes("rainwater_harvesting_experience"), ...yes("stp_experience"),
    ];
    if (influence.length && design.length) {
      const triggers = [...design, ...influence];
      add({
        rule_key: "organization.architect_specification",
        intervention: "Integrated Water Management",
        potential: influence.some((i) => i.value === "High") ? "High" : "Medium",
        confidence: confidenceFor(triggers, { inferredContext: typeInferred }),
        reason:
          `${typeLabel} with sourced evidence of water-conscious design work (${quote(design)}) and ${influence[0].value.toLowerCase()} influence over water decisions (${quote(influence)}). ` +
          `They may be a channel for specifying water systems on the projects they design. Opportunities on specific projects are tracked on each project.${crmNote}`,
        evidence_refs: [...triggers, ...all("influence_reason"), typeRef],
      });
    }
  }

  // Developer: several projects (recorded links or a sourced active-project count) → portfolio relationship.
  if (ctx.views.includes("developers")) {
    const countFact = facts.find((f) => f.fact_key === "active_project_count" && Number(f.value) >= 2);
    const linked = ctx.developerProjects.filter((l) => TRUSTED.includes(l.provenance));
    if (countFact || linked.length >= 2) {
      const linkRefs: EvidenceRef[] = linked.slice(0, 5).map((l) => ({
        kind: "link", entity: "project", entity_id: l.project_id, key: "stakeholder_role", label: `${l.role} on project`, value: l.project_name, provenance: l.provenance, source: l.source,
      }));
      const triggers = countFact ? [ref(countFact), ...linkRefs] : linkRefs;
      const sustain = [...all("sustainability_focus"), ...yes("esg_focus"), ...yes("green_building_experience")];
      const n = Math.max(countFact ? Number(countFact.value) : 0, linked.length);
      add({
        rule_key: "organization.developer_portfolio",
        intervention: "Integrated Water Management",
        potential: level(2 + (n >= 5 ? 1 : 0) + (sustain.length ? 1 : 0)),
        confidence: confidenceFor(triggers, { inferredContext: typeInferred }),
        reason:
          `${typeLabel} with sourced evidence of ${n} projects (${quote(triggers)})${sustain.length ? ` and a sourced sustainability focus (${quote(sustain)})` : ""}. ` +
          `A portfolio-level water relationship may be worth exploring. Opportunities on specific projects stay on each project and are not implied for the whole organization.${crmNote}`,
        evidence_refs: [...triggers, ...sustain, typeRef],
      });
    }
  }

  // Facility-level rules (hospitals, hotels, factories, campuses, apartments…): from the organization's own water evidence.
  if (o.group && FACILITY_GROUPS.includes(o.group)) {
    const notes: EvidenceRef[] = (o.water_info ?? [])
      .filter((w) => TRUSTED.includes(w.provenance))
      .map((w, i) => ({ kind: "water_info", entity: "organization", entity_id: o.id, key: `water_info.${i}`, label: "Water information", value: w.text, provenance: w.provenance, source: w.source }));
    const systems = facts.filter((f) => f.fact_key === "existing_water_systems");
    const reqs = all("water_requirements");
    const mentions = (term: RegExp, want: "present" | "absent") => [...notes, ...reqs].filter((r) => textMention(r.value, term) === want);
    const system = (name: string) => systems.filter((f) => f.value === name).map(ref);

    const stp = [...system("STP"), ...mentions(TERMS.stp, "present")];
    const noStp = mentions(TERMS.stp, "absent");
    const reuse = [...system("Wastewater Reuse"), ...system("Water Recycling"), ...system("Greywater Reuse"), ...mentions(TERMS.reuse, "present")];
    const textual = (refs: EvidenceRef[]) => refs.every((r) => r.kind === "water_info" || r.key === "water_requirements");

    if (stp.length && !reuse.length) {
      add({
        rule_key: "organization.sewage_reuse",
        intervention: "Sewage Reuse",
        potential: level(2 + (["Hospital", "Hotel", "IT / Technology", "College / University", "Apartment"].includes(o.org_type) ? 1 : 0)),
        confidence: confidenceFor(stp, { textual: textual(stp), inferredContext: typeInferred }),
        reason: `${typeLabel} with sourced evidence of an STP (${quote(stp)}) but no sourced evidence of treated-water reuse. Wastewater reuse may be worth investigating.${crmNote}`,
        evidence_refs: [...stp, typeRef],
      });
    } else if (noStp.length && !stp.length) {
      add({
        rule_key: "organization.stp",
        intervention: "STP",
        potential: "Medium",
        confidence: confidenceFor(noStp, { textual: true, inferredContext: typeInferred }),
        reason: `${typeLabel}; sourced information says there is no STP (${quote(noStp)}). An STP may be worth investigating.${crmNote}`,
        evidence_refs: [...noStp, typeRef],
      });
    }

    const effluent = mentions(TERMS.etp, "present");
    if (effluent.length && !reuse.length && ["Manufacturing", "Industrial"].includes(o.org_type)) {
      add({
        rule_key: "organization.water_recycling",
        intervention: "Water Recycling",
        potential: "High",
        confidence: confidenceFor(effluent, { textual: true, inferredContext: typeInferred }),
        reason: `${typeLabel} with sourced evidence of effluent treatment (${quote(effluent)}) but no sourced evidence of recycling. Recycling treated effluent may be worth investigating.${crmNote}`,
        evidence_refs: [...effluent, typeRef],
      });
    }

    const groundwater = mentions(TERMS.groundwater, "present");
    if (groundwater.length) {
      add({
        rule_key: "organization.groundwater_management",
        intervention: "Groundwater Management",
        potential: "Medium",
        confidence: confidenceFor(groundwater, { textual: true, inferredContext: typeInferred }),
        reason: `${typeLabel} with sourced evidence of groundwater / borewell use (${quote(groundwater)}). Groundwater monitoring and recharge may be worth investigating.${crmNote}`,
        evidence_refs: [...groundwater, typeRef],
      });
    }

    const tanker = mentions(TERMS.tanker, "present");
    if (tanker.length) {
      add({
        rule_key: "organization.alternative_water_supply",
        intervention: "Alternative Water Supply",
        potential: "High",
        confidence: confidenceFor(tanker, { textual: true, inferredContext: typeInferred }),
        reason: `${typeLabel} with sourced evidence of tanker water use (${quote(tanker)}). Reducing tanker dependence may be worth investigating.${crmNote}`,
        evidence_refs: [...tanker, typeRef],
      });
    }

    const leaks = mentions(TERMS.leak, "present");
    if (leaks.length && !system("Leak Detection").length) {
      add({
        rule_key: "organization.leak_detection",
        intervention: "Leak Detection",
        potential: "Medium",
        confidence: confidenceFor(leaks, { textual: true, inferredContext: typeInferred }),
        reason: `${typeLabel}; sourced information mentions leaks or water losses (${quote(leaks)}). Leak detection may be worth investigating.${crmNote}`,
        evidence_refs: [...leaks, typeRef],
      });
    }

    const demand = [...reqs, ...notes.filter((n) => TERMS.demand.test(n.value))];
    if (demand.length && !system("Water-efficient Fixtures").length) {
      add({
        rule_key: "organization.water_efficiency",
        intervention: "Water Efficiency",
        potential: "Medium",
        confidence: confidenceFor(demand, { textual: true, inferredContext: typeInferred }),
        reason: `${typeLabel} with sourced information about its water demand (${quote(demand)}). Water-efficiency measures may be worth investigating.${crmNote}`,
        evidence_refs: [...demand, typeRef],
      });
    }
  }

  return drafts.map((d) => ({ ...d, evidence_refs: dedupeRefs(d.evidence_refs) }));
}

/* ------------------------------------------------------------------ loading context */

export async function loadProjectContext(q: Queryable, projectId: number): Promise<ProjectContext | null> {
  const p = (
    await q.query<ProjectContext["project"] & { merged_into: number | null }>(
      `SELECT id, name, project_type, lifecycle_stage, scale, built_up_area_sqft::float8 AS built_up_area_sqft, building_count, unit_count, field_sources, merged_into
         FROM projects WHERE id = $1`,
      [projectId],
    )
  ).rows[0];
  if (!p || p.merged_into) return null;
  const facts = (
    await q.query<Fact>(
      `SELECT f.id, f.fact_key, d.label, f.value, f.note, f.source, f.provenance, f.confidence, NULL AS created_by_name, f.created_at, f.retired_at, f.replaces_fact_id
         FROM project_facts f JOIN fact_definitions d ON d.key = f.fact_key WHERE f.project_id = $1 AND f.retired_at IS NULL ORDER BY d.sort_order, f.id`,
      [projectId],
    )
  ).rows;
  const units = Object.fromEntries(
    (await q.query<{ key: string; unit: string | null }>(`SELECT key, unit FROM fact_definitions WHERE applies_to = 'project'`)).rows.map((r) => [r.key, r.unit]),
  );
  return { project: p, facts, units };
}

export async function loadOrganizationContext(q: Queryable, organizationId: number): Promise<OrganizationContext | null> {
  const o = (
    await q.query<{ id: number; name: string; org_type: string; group: string | null; field_sources: Record<string, FieldSource>; water_info: WaterInfo[] | null; merged_into: number | null }>(
      `SELECT org.id, org.name, org.org_type, t.group_key AS "group", org.field_sources, org.intelligence->'waterInfo' AS water_info, org.merged_into
         FROM organizations org LEFT JOIN organization_types t ON t.name = org.org_type WHERE org.id = $1`,
      [organizationId],
    )
  ).rows[0];
  if (!o || o.merged_into) return null;
  const facts = (
    await q.query<Fact>(
      `SELECT f.id, f.fact_key, d.label, f.value, f.note, f.source, f.provenance, f.confidence, NULL AS created_by_name, f.created_at, f.retired_at, f.replaces_fact_id
         FROM organization_facts f JOIN fact_definitions d ON d.key = f.fact_key WHERE f.organization_id = $1 AND f.retired_at IS NULL ORDER BY d.sort_order, f.id`,
      [organizationId],
    )
  ).rows;
  const views = (await q.query<{ view_key: string }>(`SELECT view_key FROM organization_view_types WHERE type_name = $1 ORDER BY view_key`, [o.org_type])).rows.map((r) => r.view_key);
  const developerProjects = (
    await q.query<OrganizationContext["developerProjects"][number]>(
      `SELECT po.project_id, p.name AS project_name, po.role, po.provenance, po.source
         FROM project_organizations po JOIN projects p ON p.id = po.project_id
        WHERE po.organization_id = $1 AND po.role IN ('Developer', 'Owner') AND p.merged_into IS NULL ORDER BY p.name`,
      [organizationId],
    )
  ).rows;
  const crmRelationship =
    (
      await q.query<{ id: number; status: string }>(
        `SELECT o.id, o.status FROM crm_opportunities o JOIN pipeline_stages ps ON ps.pipeline = o.pipeline AND ps.name = o.status
          WHERE o.organization_id = $1 AND o.pipeline = 'relationship' AND ps.kind = 'open' ORDER BY o.created_at LIMIT 1`,
        [organizationId],
      )
    ).rows[0] ?? null;
  const { merged_into: _m, water_info, ...org } = o;
  return { organization: { ...org, water_info: Array.isArray(water_info) ? water_info : [] }, facts, views, developerProjects, crmRelationship };
}
