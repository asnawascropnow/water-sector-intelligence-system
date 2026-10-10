import { before, test } from "node:test";
import assert from "node:assert/strict";
import { initDb, type Database } from "../db";
import { insertOrganization } from "../lib/organizations";
import { findDuplicates } from "../lib/duplicates";
import { normalizeRecord } from "../lib/normalize";
import { assessOrganization, type OrgForAssessment } from "./opportunity";
import { dailyBrief, refreshRecommendations } from "./runner";

let db: Database;
before(async () => {
  process.env.PGLITE_DATA_DIR = "memory://";
  process.env.GEOCODER = "none";
  delete process.env.DATABASE_URL;
  db = await initDb();
  await db.query(`INSERT INTO users (name) VALUES ('Fayaas'), ('Akash')`);
});

async function addOrg(input: Parameters<typeof normalizeRecord>[0]) {
  const n = normalizeRecord(input, "test");
  return insertOrganization(db, n.data, { fieldSources: n.field_sources, sourceId: null, actorId: 1, activitySummary: "test" });
}

const base: OrgForAssessment = {
  id: 1, name: "X", org_type: "Other", sector: null, address: null, area: null, lat: null, phone: null, email: null, website: null, field_sources: {}, intelligence: {},
};

test("opportunity agent: no information → Unknown, never guesses", () => {
  const r = assessOrganization(base);
  assert.equal(r.potential, "Unknown");
  assert.equal(r.confidence, "Unknown");
  assert.equal(r.provenance, "AI Inference");
});

test("opportunity agent: water-intensive manufacturer in industrial cluster → High with reasons", () => {
  const r = assessOrganization({ ...base, org_type: "Manufacturing", sector: "Textile dyeing", area: "Peenya", phone: "+91 80 1234 5678", lat: 13.03, address: "Peenya" });
  assert.equal(r.potential, "High");
  assert.ok(r.reasons.some((x) => /water-intensive/.test(x)));
  assert.ok(r.reasons.some((x) => /industrial cluster/.test(x)));
});

test("duplicate detection: legal-suffix variant with same phone is an existing match", async () => {
  await addOrg({ name: "ABC Industries Pvt Ltd", phone: "080 2839 1234", address: "Plot 12, Peenya 2nd Phase", lat: 13.03, lng: 77.52 });
  const r = await findDuplicates(db, normalizeRecord({ name: "ABC Industry Private Limited", phone: "+91 80 2839 1234" }, "t").data);
  assert.equal(r.level, "existing");
  assert.match(r.candidates[0].reasons.join(" "), /phone/);
  const other = await findDuplicates(db, normalizeRecord({ name: "Completely Different Hotel", phone: "9999999999" }, "t").data);
  assert.equal(other.level, "new");
});

test("next action agent: stale proposal → follow up; unassigned → assign; daily brief counts", async () => {
  const a = await addOrg({ name: "Proposal Pending Foods", org_type: "Manufacturing" });
  const b = await addOrg({ name: "Nobody Owns Me Hospital", org_type: "Hospital" });
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO crm_opportunities (organization_id, owner_id, status, proposal_status, proposal_sent_at, created_at)
     VALUES ($1, 2, 'Proposal Sent', 'Sent', now() - interval '6 days', now() - interval '20 days') RETURNING id`,
    [a],
  );
  await db.query(`INSERT INTO activities (organization_id, opportunity_id, type, summary, occurred_at) VALUES ($1, $2, 'proposal_sent', 'Proposal sent', now() - interval '6 days')`, [a, rows[0].id]);
  await db.query(`INSERT INTO crm_opportunities (organization_id, status) VALUES ($1, 'New')`, [b]);
  await refreshRecommendations(db);
  const brief = await dailyBrief(db, null);
  const titles = brief.recommendations.map((r) => r.title);
  assert.ok(titles.includes("Follow up with Proposal Pending Foods"), titles.join(" | "));
  const follow = brief.recommendations.find((r) => r.title === "Follow up with Proposal Pending Foods")!;
  assert.match(follow.reason, /Proposal was sent 6 days ago/);
  assert.equal(follow.assigned_name, "Akash");
  assert.ok(titles.includes("Assign Nobody Owns Me Hospital"));
  assert.equal(brief.counts.proposalsAwaitingResponse, 1);
  assert.equal(brief.counts.unassignedOpportunities, 1);

  // Condition cleared → recommendation auto-resolves
  await db.query(`UPDATE crm_opportunities SET owner_id = 1 WHERE organization_id = $1`, [b]);
  const after = await dailyBrief(db, null);
  assert.ok(!after.recommendations.some((r) => r.title === "Assign Nobody Owns Me Hospital"));
});

test("opportunity agent: recorded water information counts, including plural wording", () => {
  for (const text of ["Uses 2 borewells", "Buys 20 tankers a month", "Has an STP"]) {
    const r = assessOrganization({ ...base, org_type: "School", intelligence: { waterInfo: [{ text, provenance: "Verified", source: "visit" }] } });
    assert.ok(r.reasons.some((x) => x.includes(text)), `"${text}" should be used as evidence`);
  }
});
