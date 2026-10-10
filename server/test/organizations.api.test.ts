import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../db";
import { startTestApi, type TestApi } from "./helpers";

let api: TestApi;
before(async () => {
  api = await startTestApi();
});
after(() => api.close());

const peenya = {
  name: "ABC Industries Pvt Ltd",
  sector: "Textile dyeing",
  address: "Plot 12, 2nd Phase, Peenya Industrial Area, Bengaluru 560058",
  phone: "080 2839 1234",
  website: "abcindustries.in",
  lat: 13.03,
  lng: 77.52,
  contact_name: "R. Kumar",
  contact_designation: "Plant Head",
};
let abcId: number;

test("manual create: normalises fields, labels provenance, logs timeline and audit", async () => {
  const { status, body } = await api.call("POST", "/organizations", { data: peenya });
  assert.equal(status, 201);
  assert.equal(body.merged, false);
  abcId = body.id;
  const d = (await api.call("GET", `/organizations/${abcId}`)).body;
  const o = d.organization;
  assert.equal(o.phone, "+91 80 2839 1234");
  assert.equal(o.website, "https://abcindustries.in");
  assert.equal(o.area, "Peenya");
  assert.equal(o.pincode, "560058");
  assert.equal(o.org_type, "Manufacturing");
  assert.equal(o.field_sources.org_type.provenance, "AI Inference", "type inferred from the name must be labelled");
  assert.equal(o.field_sources.phone.provenance, "Unverified");
  assert.match(o.source_label, /Manual entry by Fayaas/);
  assert.equal(o.intelligence.potential, "High");
  assert.equal(d.contacts[0].name, "R. Kumar");
  assert.equal(d.opportunity, null, "an organization is not a CRM opportunity");
  assert.ok(d.activities.some((a: { summary: string }) => a.summary === "Organization added by Fayaas"));
  const audit = await db().query(`SELECT 1 FROM audit_logs WHERE entity = 'organization' AND entity_id = $1 AND action = 'create'`, [abcId]);
  assert.equal(audit.rows.length, 1);
});

test("manual create: missing name is rejected", async () => {
  const { status } = await api.call("POST", "/organizations", { data: { name: "  " } });
  assert.equal(status, 400);
});

test("duplicate detection blocks a legal-suffix variant; keep-separate and merge both work", async () => {
  const variant = { name: "ABC Industry Private Limited", phone: "+91 80 2839 1234", email: "info@abcindustries.in", sector: "Garments" };
  const blocked = await api.call("POST", "/organizations", { data: variant });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.duplicate.level, "existing");
  assert.equal(blocked.body.duplicate.candidates[0].id, abcId);

  const merged = await api.call("POST", "/organizations", { data: variant, merge_into: abcId });
  assert.equal(merged.status, 201);
  assert.equal(merged.body.merged, true);
  const o = (await api.call("GET", `/organizations/${abcId}`)).body;
  assert.equal(o.organization.email, "info@abcindustries.in", "empty field filled by merge");
  assert.equal(o.organization.sector, "Textile dyeing", "existing value never overwritten");
  assert.ok(o.activities.some((a: { type: string; details: { conflicts: string[] } }) => a.type === "merged" && a.details.conflicts.some((c) => c.startsWith("sector"))));

  const separate = await api.call("POST", "/organizations", { data: { ...variant, name: "ABC Industries Unit 2" }, force: true });
  assert.equal(separate.status, 201);
});

test("check-duplicates endpoint", async () => {
  const { body } = await api.call("POST", "/organizations/check-duplicates", { name: "abc industries ltd", phone: "08028391234" });
  assert.notEqual(body.level, "new");
  const none = await api.call("POST", "/organizations/check-duplicates", { name: "Completely Unrelated Hotel" });
  assert.equal(none.body.level, "new");
});

test("edit: values become Verified, invalid edits are rejected", async () => {
  const ok = await api.call("PATCH", `/organizations/${abcId}`, { sector: "Textile dyeing & finishing" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.field_sources.sector.provenance, "Verified");
  assert.match(ok.body.field_sources.sector.source, /Edited by Fayaas/);
  assert.equal((await api.call("PATCH", `/organizations/${abcId}`, { lat: 19.07, lng: 72.87 })).status, 400, "outside Bengaluru");
  assert.equal((await api.call("PATCH", `/organizations/${abcId}`, { lat: 12.97 })).status, 400, "lat without lng");
  assert.equal((await api.call("PATCH", `/organizations/${abcId}`, { org_type: "Spaceport" })).status, 400, "unknown type");
  assert.equal((await api.call("PATCH", `/organizations/${abcId}`, { name: "" })).status, 400, "empty name");
});

test("list filters: search, type, area, CRM membership", async () => {
  await api.call("POST", "/organizations", { data: { name: "Sunrise Hospital", org_type: "Hospital", address: "Hosur Road, Koramangala, Bengaluru 560034" }, force: true });
  const byQ = (await api.call("GET", "/organizations?q=sunrise")).body;
  assert.deepEqual(byQ.map((o: { name: string }) => o.name), ["Sunrise Hospital"]);
  const byType = (await api.call("GET", "/organizations?type=Hospital")).body;
  assert.ok(byType.every((o: { org_type: string }) => o.org_type === "Hospital"));
  const byArea = (await api.call("GET", "/organizations?area=Koramangala")).body;
  assert.equal(byArea.length, 1);
  assert.equal((await api.call("GET", "/organizations?crm=in")).body.length, 0);
  const areas = (await api.call("GET", "/organizations/areas")).body;
  assert.ok(areas.includes("Peenya") && areas.includes("Koramangala"));
});

test("contacts and water information", async () => {
  assert.equal((await api.call("POST", `/organizations/${abcId}/contacts`, { name: "" })).status, 400);
  const c = await api.call("POST", `/organizations/${abcId}/contacts`, { name: "Meena S", designation: "EHS Manager", is_primary: true });
  assert.equal(c.status, 201);
  const w = await api.call("POST", `/organizations/${abcId}/water-info`, { text: "Uses 2 borewells and tankers", provenance: "Verified", source: "Site visit" });
  assert.equal(w.status, 201);
  const d = (await api.call("GET", `/organizations/${abcId}`)).body;
  assert.equal(d.contacts.find((x: { is_primary: boolean }) => x.is_primary).name, "Meena S");
  assert.equal(d.organization.intelligence.waterInfo[0].provenance, "Verified");
  assert.ok(d.organization.intelligence.reasons.some((r: string) => /borewell/.test(r)), "assessment uses recorded water info");
});

test("assess and enrich agents (no network: enrichment reports what it checked)", async () => {
  const a = await api.call("POST", `/organizations/${abcId}/assess`);
  assert.equal(a.body.provenance, "AI Inference");
  const sunrise = (await api.call("GET", "/organizations?q=sunrise")).body[0];
  const e = await api.call("POST", `/organizations/${sunrise.id}/enrich`);
  assert.equal(e.status, 200);
  assert.deepEqual(e.body, { added: 0, sourcesTried: [] });
});

test("merge one record into another: history moves, source is hidden", async () => {
  const dup = await api.call("POST", "/organizations", { data: { name: "Sunrise Hospitals Koramangala" }, force: true });
  await api.call("POST", `/organizations/${dup.body.id}/contacts`, { name: "Dr. Rao" });
  const target = (await api.call("GET", "/organizations?q=sunrise hospital")).body.find((o: { name: string }) => o.name === "Sunrise Hospital");
  const m = await api.call("POST", `/organizations/${dup.body.id}/merge-into/${target.id}`);
  assert.equal(m.status, 200);
  const list = (await api.call("GET", "/organizations?q=sunrise")).body;
  assert.ok(!list.some((o: { id: number }) => o.id === dup.body.id), "merged record hidden from lists");
  assert.deepEqual((await api.call("GET", `/organizations/${dup.body.id}`)).body, { merged_into: target.id });
  const t = (await api.call("GET", `/organizations/${target.id}`)).body;
  assert.ok(t.contacts.some((c: { name: string }) => c.name === "Dr. Rao"));
  assert.equal((await api.call("POST", `/organizations/${target.id}/merge-into/${target.id}`)).status, 400);
});

test("bad and unknown ids", async () => {
  assert.equal((await api.call("GET", "/organizations/abc")).status, 400);
  assert.equal((await api.call("GET", "/organizations/999999")).status, 404);
});
