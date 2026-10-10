import type { Queryable } from "../db";
import { HttpError } from "../lib/http";
import { PRIMARY_OPPORTUNITY_ORDER } from "../lib/crm";
import { llmEnabled, llmModel } from "../extraction/llm";
import type { AiDraft, SequenceStep } from "../../shared/email";
import type { FieldSource, Intelligence } from "../../shared/types";
import { findPlaceholders, unknownVariables } from "./template";

/**
 * AI drafting with Gemini (GEMINI_API_KEY). Drafts are suggestions only: they are returned to the user, who edits
 * them into a step template or saves them as a personalized draft that must be approved before it can be sent.
 * The model only sees facts already recorded in WSIS, each labelled with its provenance.
 */

export interface DraftFacts {
  verified: string[]; // facts from CRM records (with provenance label)
  inferred: string[]; // AI Inference / Estimated / Unverified items, to be treated as hypotheses
  history: string[]; // recent CRM interactions (summaries)
}

export interface DraftRequest {
  mode: "template" | "personal";
  campaign: { name: string; description: string | null };
  step: { order: number; total: number; purpose: string | null; previous_subjects: string[] };
  facts: DraftFacts;
  sender: { name: string | null; company: string | null };
}

export type DraftGenerator = (prompt: string) => Promise<string>;

let generatorOverride: DraftGenerator | null = null;
/** Tests inject a fake model here. */
export function setDraftGenerator(g: DraftGenerator | null) {
  generatorOverride = g;
}

async function gemini(prompt: string): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const res = await ai.models.generateContent({ model: llmModel(), contents: prompt, config: { responseMimeType: "application/json", temperature: 0.4 } });
  return res.text ?? "";
}

export const draftingEnabled = () => Boolean(generatorOverride) || llmEnabled();

const label = (fs: FieldSource | undefined) => (fs ? ` [${fs.provenance}${fs.source ? `, source: ${fs.source}` : ""}]` : "");

export async function gatherFacts(q: Queryable, contactId: number): Promise<DraftFacts> {
  const { rows } = await q.query<{
    name: string;
    designation: string | null;
    org_id: number;
    org_name: string;
    org_type: string;
    sector: string | null;
    area: string | null;
    website: string | null;
    field_sources: Record<string, FieldSource>;
    intelligence: Intelligence;
    crm_status: string | null;
    opportunity_id: number | null;
  }>(
    `SELECT c.name, c.designation, org.id AS org_id, org.name AS org_name, org.org_type, org.sector, org.area, org.website, org.field_sources, org.intelligence,
            o.status AS crm_status, o.id AS opportunity_id
       FROM contacts c JOIN organizations org ON org.id = c.organization_id
       LEFT JOIN LATERAL (SELECT o.id, o.status FROM crm_opportunities o WHERE o.organization_id = org.id ORDER BY ${PRIMARY_OPPORTUNITY_ORDER} LIMIT 1) o ON TRUE
      WHERE c.id = $1`,
    [contactId],
  );
  const r = rows[0];
  if (!r) throw new HttpError(404, "Contact not found");
  const fs = r.field_sources ?? {};
  const verified: string[] = [`Recipient name: ${r.name}`, `Organization: ${r.org_name}${label(fs.name)}`];
  const inferred: string[] = [];
  if (r.designation) verified.push(`Recipient designation (as recorded in CRM): ${r.designation}`);
  if (r.org_type && r.org_type !== "Other") (fs.org_type?.provenance === "Verified" ? verified : inferred).push(`Organization type: ${r.org_type}${label(fs.org_type)}`);
  if (r.sector) (fs.sector?.provenance === "Verified" ? verified : inferred).push(`Sector: ${r.sector}${label(fs.sector)}`);
  if (r.area) verified.push(`Location: ${r.area}, Bengaluru`);
  if (r.website) verified.push(`Website: ${r.website}`);
  for (const w of r.intelligence?.waterInfo ?? []) {
    (w.provenance === "Verified" ? verified : inferred).push(`Water-related information: ${w.text} [${w.provenance}${w.source ? `, source: ${w.source}` : ""}]`);
  }
  if (r.intelligence?.potential && r.intelligence.potential !== "Unknown") {
    inferred.push(`WSIS internal assessment (AI Inference, do not mention to recipient): ${r.intelligence.potential} potential — ${(r.intelligence.reasons ?? []).join("; ")}`);
  }
  if (r.crm_status) verified.push(`Our CRM stage with them: ${r.crm_status} (internal; do not mention)`);
  const history = r.opportunity_id
    ? (
        await q.query<{ summary: string; occurred_at: string }>(
          `SELECT summary, occurred_at FROM activities WHERE organization_id = $1 AND type IN ('connected','call_completed','call_scheduled','proposal_sent','note','contact_attempted','no_response','email_sent','email_reply')
            ORDER BY occurred_at DESC LIMIT 6`,
          [r.org_id],
        )
      ).rows.map((a) => `${String(a.occurred_at).slice(0, 10)}: ${a.summary.slice(0, 240)}`)
    : [];
  return { verified, inferred, history };
}

export function buildPrompt(req: DraftRequest): string {
  const personal = req.mode === "personal";
  return `You draft one short, professional B2B email for a water-sector services company in Bengaluru, India. A person will review and edit it before anything is sent.

SENDER: ${req.sender.name ?? "[[Sender name]]"}${req.sender.company ? `, ${req.sender.company}` : ""}
CAMPAIGN: ${req.campaign.name}
WHAT WE OFFER (from the campaign description; the only source for our services): ${req.campaign.description?.trim() || "(not provided — use [[Describe our relevant service]])"}
THIS EMAIL: step ${req.step.order} of ${req.step.total}${req.step.purpose ? ` — purpose: ${req.step.purpose}` : ""}
${req.step.previous_subjects.length ? `EARLIER EMAILS IN THE SEQUENCE: ${req.step.previous_subjects.join(" | ")}` : ""}

${
  personal
    ? `KNOWN FACTS (recorded in our CRM — you may rely on these):
${req.facts.verified.map((f) => `- ${f}`).join("\n") || "- none"}

UNCONFIRMED ITEMS (hypotheses only — if used, phrase as a question or possibility, never as fact):
${req.facts.inferred.map((f) => `- ${f}`).join("\n") || "- none"}

PREVIOUS INTERACTIONS (internal context):
${req.facts.history.map((f) => `- ${f}`).join("\n") || "- none"}`
    : `This is a TEMPLATE sent to many recipients. Do not refer to any specific organization's details. Use only these variables where useful:
{{contact.first_name|there}}, {{organization.name}}, {{organization.area|Bengaluru}}, {{organization.org_type|organization}}, {{sender.name}}, {{sender.company}}.`
}

RULES:
- Never invent or assume a project, project stage, water demand, volumes, costs, technical requirements, certifications, deadlines, or the recipient's responsibilities.
- Do not state anything from UNCONFIRMED ITEMS or internal assessments as fact; never mention scores, "potential", or our CRM stage.
- Where a specific detail would help but is not known, insert a placeholder in double square brackets, e.g. [[specific project or site]].
- Be honest about who we are; no false urgency, no fake "Re:"/"Fwd:" subjects, no misleading claims, no spam-filter tricks.
- 90–160 words, plain text, no markdown, no signature block beyond the sender name (an unsubscribe footer is added automatically).
- Subject: under 70 characters.

Return ONLY JSON: {"subject": string, "text_body": string, "facts_used": string[] (facts from KNOWN FACTS you relied on), "hypotheses": string[] (anything framed as a possibility), "placeholders": string[]}`;
}

function parse(text: string): Partial<AiDraft> | null {
  const cleaned = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    try {
      return m ? JSON.parse(m[0]) : null;
    } catch {
      return null;
    }
  }
}

const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => x.slice(0, 300)).slice(0, 20) : []);

/** Validate model output and flag anything a reviewer should check. */
export function checkDraft(raw: Partial<AiDraft> | null, req: DraftRequest): AiDraft {
  if (!raw || typeof raw.subject !== "string" || typeof raw.text_body !== "string" || !raw.subject.trim() || !raw.text_body.trim()) {
    throw new HttpError(502, "The AI returned an unusable draft. Try again or write the email manually.");
  }
  const subject = raw.subject.trim().slice(0, 200);
  const text_body = raw.text_body.trim().slice(0, 6000);
  const warnings: string[] = [];
  const factText = [...req.facts.verified, ...req.facts.inferred, ...req.facts.history, req.campaign.description ?? ""].join(" ");
  const numbers = [...new Set((`${subject} ${text_body}`.match(/\d[\d,.]*\s*(%|kld|kl|mld|litres?|liters?|m3|crore|lakh|lakhs|rs\.?|inr|₹)?/gi) ?? []).map((n) => n.trim()))].filter(
    (n) => !factText.includes(n.replace(/\s.*$/, "")),
  );
  if (numbers.length) warnings.push(`Contains figures not found in WSIS records — verify or remove: ${numbers.join(", ")}`);
  const unknown = unknownVariables(`${subject}\n${text_body}`);
  if (unknown.length) warnings.push(`Unknown variables will not render: ${unknown.join(", ")}`);
  if (/\b(re|fwd?):/i.test(subject)) warnings.push("Subject looks like a reply/forward — remove that prefix");
  const placeholders = findPlaceholders(subject, text_body);
  if (placeholders.length) warnings.push("Fill in the [[placeholders]] before approval");
  return { subject, text_body, facts_used: strList(raw.facts_used), hypotheses: strList(raw.hypotheses), placeholders, warnings };
}

export async function generateDraft(
  q: Queryable,
  opts: { campaign: { name: string; description: string | null }; steps: SequenceStep[]; stepOrder: number; contactId?: number | null; purpose?: string | null; sender: DraftRequest["sender"] },
): Promise<AiDraft> {
  if (!draftingEnabled()) throw new HttpError(503, "AI drafting is not configured. Set GEMINI_API_KEY on the server.");
  const previous = opts.steps.filter((s) => s.step_order < opts.stepOrder && s.active).map((s) => s.subject_template);
  const req: DraftRequest = {
    mode: opts.contactId ? "personal" : "template",
    campaign: opts.campaign,
    step: { order: opts.stepOrder, total: Math.max(opts.steps.length, opts.stepOrder), purpose: opts.purpose?.slice(0, 300) ?? null, previous_subjects: previous },
    facts: opts.contactId ? await gatherFacts(q, opts.contactId) : { verified: [], inferred: [], history: [] },
    sender: opts.sender,
  };
  const text = await (generatorOverride ?? gemini)(buildPrompt(req));
  return checkDraft(parse(text), req);
}
