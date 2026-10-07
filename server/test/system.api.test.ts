import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, type TestApi } from "./helpers";
import { loadMigrations } from "../db/migrate";

// Starts with the legacy demo seed enabled to lock in Rule 2 (no invented data) for seeded records.
let api: TestApi;
before(async () => {
  delete process.env.SEED_DEMO_DATA;
  api = await startTestApi({ demoData: true });
});
after(() => api.close());

test("GET /api/system reports database, geocoder, AI and schema version", async () => {
  const { status, body } = await api.call("GET", "/system");
  assert.equal(status, 200);
  assert.ok(["pglite", "postgres"].includes(body.database));
  assert.equal(body.geocoder, "none");
  assert.equal(body.llm, false);
  assert.equal(body.schemaVersion, loadMigrations().at(-1)!.version);
});

test("seed creates the two team users", async () => {
  const { body } = await api.call("GET", "/users");
  assert.deepEqual(body.map((u: { name: string }) => u.name).sort(), ["Akash", "Fayaas"]);
});

test("legacy seed: 145 Bengaluru organizations, all unverified/low confidence, no invented contact data", async () => {
  const { body } = await api.call("GET", "/organizations");
  assert.equal(body.length, 145);
  for (const o of body) {
    assert.equal(o.data_confidence, "Low");
    assert.equal(o.phone, null, `${o.name} must not carry an invented phone`);
    assert.equal(o.email, null, `${o.name} must not carry an invented email`);
    assert.equal(o.field_sources.name.provenance, "Unverified");
    assert.equal(o.source_label, "Legacy prototype dataset (unverified)");
    assert.ok(o.lat >= 12.72 && o.lat <= 13.35 && o.lng >= 77.3 && o.lng <= 77.92, `${o.name} must be inside Bengaluru`);
    assert.ok(["High", "Medium", "Low", "Unknown"].includes(o.intelligence.potential));
    assert.equal(o.intelligence.provenance, "AI Inference");
  }
});

test("map data: every located organization has coordinates and a type", async () => {
  const { body } = await api.call("GET", "/organizations");
  const located = body.filter((o: { lat: number | null }) => o.lat != null);
  assert.equal(located.length, 145);
  assert.ok(located.every((o: { org_type: string; lng: number }) => o.org_type && typeof o.lng === "number"));
});

test("unknown API route returns JSON 404; malformed JSON returns 400", async () => {
  const nf = await api.call("GET", "/does-not-exist");
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error, "Not found");
  const bad = await api.call("POST", "/organizations", "{not json");
  assert.equal(bad.status, 400);
});

test("dashboard summary on a freshly seeded database", async () => {
  const { body } = await api.call("GET", "/dashboard/summary");
  assert.equal(body.totalOrganizations, 145);
  assert.equal(body.crmOpportunities, 0);
  assert.equal(body.overdueFollowUps, 0);
  assert.deepEqual(body.pipeline, []);
});
