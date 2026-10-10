import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startTestApi, waitForImport, type TestApi } from "./helpers";

let api: TestApi;
before(async () => {
  api = await startTestApi();
  // An organization that already exists, so the import finds an "existing" match.
  await api.call("POST", "/organizations", { data: { name: "Indian Institute of Science", website: "iisc.ac.in", address: "CV Raman Road, Malleshwaram", lat: 13.0184, lng: 77.5673 } });
});
after(() => api.close());

const CSV = `Company Name,Industry,Address,Phone,Email,Website,Latitude,Longitude
ABC Industries Pvt Ltd,Textile dyeing,"Plot 12, Peenya 2nd Phase, Bengaluru 560058",080 2839 1234,info@abc.in,abcindustries.in,13.03,77.52
ABC Industry Private Limited,Textiles,"Plot 12, Peenya, Bengaluru",+91 80 2839 1234,,,,
IISc Bangalore,,"CV Raman Road, Malleshwaram, Bengaluru 560012",,,iisc.ac.in,,
Sunrise Hospital,Healthcare,"Hosur Road, Koramangala 560034",9845012345,contact@sunrise.in,,12.93,77.62
`;

test("upload validation", async () => {
  assert.equal((await api.upload("/imports", "notes.txt", "hello")).status, 400);
  const res = await fetch(`${api.base}/imports`, { method: "POST", headers: { "x-user-id": "1" } });
  assert.equal(res.status, 400);
});

test("CSV import: extract, normalise, classify duplicates, nothing saved before review", async () => {
  const before = (await api.call("GET", "/organizations")).body.length;
  const up = await api.upload("/imports", "field-list.csv", CSV);
  assert.equal(up.status, 202);
  const imp = await waitForImport(api, up.body.id);
  assert.equal(imp.status, "review");
  assert.equal(imp.extraction_method, "spreadsheet");
  assert.equal(imp.stats.found, 4);
  const byName = Object.fromEntries(imp.records.map((r: { data: { name: string } }) => [r.data.name, r]));
  assert.equal(byName["ABC Industries Pvt Ltd"].duplicate.level, "new");
  assert.equal(byName["ABC Industries Pvt Ltd"].data.phone, "+91 80 2839 1234");
  assert.equal(byName["ABC Industry Private Limited"].duplicate.level, "possible_duplicate", "same name as an earlier row in the file");
  assert.notEqual(byName["IISc Bangalore"].duplicate.level, "new");
  assert.ok(byName["IISc Bangalore"].warnings.some((w: string) => /Location unknown/.test(w)), "no geocoder in tests: location stays unknown");
  assert.equal(byName["IISc Bangalore"].data.lat, null);
  assert.equal((await api.call("GET", "/organizations")).body.length, before, "review comes before saving");
  (globalThis as { importId?: number }).importId = up.body.id;
});

test("review decisions: approve new, duplicate needs a decision, merge, edit, reject, completion", async () => {
  const id = (globalThis as { importId?: number }).importId!;
  const imp = (await api.call("GET", `/imports/${id}`)).body;
  const idx = (name: string) => imp.records.find((r: { data: { name: string } }) => r.data.name === name).index;

  const bulk = await api.call("POST", `/imports/${id}/approve-new`);
  assert.deepEqual(bulk.body, { approved: 2, held: 0 });

  const blocked = await api.call("POST", `/imports/${id}/records/${idx("ABC Industry Private Limited")}/approve`);
  assert.equal(blocked.status, 409, "now matches the approved ABC record");
  const merged = await api.call("POST", `/imports/${id}/records/${idx("ABC Industry Private Limited")}/merge`, {});
  assert.equal(merged.body.status, "merged");

  const edited = await api.call("POST", `/imports/${id}/records/${idx("IISc Bangalore")}/edit`, { data: { name: "IISc Bangalore", pincode: "560012", org_type: "College / University" } });
  assert.equal(edited.body.status, "pending");
  assert.equal(edited.body.data.org_type, "College / University");
  const rejected = await api.call("POST", `/imports/${id}/records/${idx("IISc Bangalore")}/reject`);
  assert.equal(rejected.body.status, "rejected");
  assert.equal((await api.call("POST", `/imports/${id}/records/${idx("IISc Bangalore")}/approve`)).status, 409, "already decided");
  assert.equal((await api.call("POST", `/imports/${id}/records/0/explode`)).status, 400);

  const done = (await api.call("GET", `/imports/${id}`)).body;
  assert.equal(done.status, "completed");
  assert.deepEqual([done.stats.approved, done.stats.merged, done.stats.rejected, done.stats.pending], [2, 1, 1, 0]);

  const saved = (await api.call("GET", "/organizations?q=sunrise")).body[0];
  assert.match(saved.source_label, /File “field-list.csv” uploaded by Fayaas/);
  const detail = (await api.call("GET", `/organizations/${saved.id}`)).body;
  assert.ok(detail.activities.some((a: { summary: string }) => /approved by Fayaas/.test(a.summary)));
});

test("API data-feed ingestion uses the same review pipeline", async () => {
  const up = await api.call("POST", "/imports/json", { source_label: "Partner feed", records: [{ name: "Lakeview Hospital", address: "Whitefield, Bengaluru 560066" }] });
  assert.equal(up.status, 202);
  const imp = await waitForImport(api, up.body.id);
  assert.equal(imp.status, "review");
  assert.equal(imp.records[0].data.area, "Whitefield");
  assert.equal((await api.call("POST", "/imports/json", { records: [] })).status, 400);
  const list = (await api.call("GET", "/imports")).body;
  assert.ok(list.some((i: { filename: string }) => i.filename === "Partner feed"));
});

test("a file with no recognisable organizations fails cleanly", async () => {
  const up = await api.upload("/imports", "empty.csv", "foo,bar\n1,2\n");
  const imp = await waitForImport(api, up.body.id);
  assert.equal(imp.status, "failed");
  assert.match(imp.error, /No organizations could be identified/);
});
