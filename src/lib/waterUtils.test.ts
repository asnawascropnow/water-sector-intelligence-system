import { test } from "node:test";
import assert from "node:assert/strict";
import type { WaterOpportunity } from "../../shared/types";
import { WATER_OPPORTUNITY_STATUSES } from "../../shared/constants";
import { evidenceLabel, generateSummary, groupWaterOpportunities, isLiveWater, isTrustedWater, WATER_SECTIONS, waterActions } from "./waterUtils";

const w = (id: number, status: WaterOpportunity["status"]) => ({ id, status }) as WaterOpportunity;

test("water panel sections: suggestions, review, approved (incl. in CRM), rejected/closed — nothing dropped", () => {
  const items = WATER_OPPORTUNITY_STATUSES.map((s, i) => w(i + 1, s));
  const g = groupWaterOpportunities(items);
  assert.deepEqual(
    Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v.map((x) => x.status)])),
    { suggestions: ["suggested"], review: ["needs_review"], approved: ["approved", "converted"], closed: ["rejected", "closed"] },
  );
  assert.equal(Object.values(g).flat().length, items.length, "rejected and closed are kept, not hidden");
  assert.deepEqual(WATER_SECTIONS.map((s) => s.title), ["AI suggestions", "Needs review", "Approved opportunities", "Rejected / closed"]);
});

test("trusted vs live, and the actions offered per status", () => {
  assert.deepEqual(WATER_OPPORTUNITY_STATUSES.filter((s) => isTrustedWater({ status: s })), ["approved", "converted"]);
  assert.deepEqual(WATER_OPPORTUNITY_STATUSES.filter((s) => !isLiveWater({ status: s })), ["rejected", "closed"]);
  assert.deepEqual(waterActions("suggested"), ["start_review", "approve", "reject", "assign"]);
  assert.ok(!waterActions("suggested").includes("convert"), "suggestions cannot go to CRM");
  assert.ok(waterActions("approved").includes("convert"));
  assert.ok(!waterActions("converted").includes("convert"), "no double conversion");
  assert.deepEqual(waterActions("rejected"), ["reconsider"]);
});

test("evidence labels quote recorded values; generate summaries never invent counts", () => {
  assert.equal(evidenceLabel({ kind: "fact", entity: "project", entity_id: 1, key: "k", label: "STP capacity", value: "120 KLD", provenance: "Verified", source: null }), "STP capacity: 120 KLD");
  assert.equal(evidenceLabel({ kind: "water_info", entity: "organization", entity_id: 1, key: "w", label: "Water information", value: "Uses tankers", provenance: "Unverified", source: null }), "“Uses tankers”");
  const zero = { created: 0, refreshed: 0, unchanged: 0, kept: 0, skipped_rejected: 0, stale: 0 };
  assert.match(generateSummary(zero), /not enough evidence/);
  assert.match(generateSummary({ ...zero, unchanged: 2 }), /up to date/);
  assert.equal(generateSummary({ ...zero, created: 1, stale: 2 }), "1 new suggestion, 2 no longer supported by the facts");
});
