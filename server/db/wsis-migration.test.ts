import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectDb, type Database } from "./index";
import { loadMigrations, migrate, MIGRATIONS_DIR } from "./migrate";
import { CRM_STATUSES, ORG_TYPES } from "../../shared/constants";

process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;
const quiet = { log: () => undefined };
const open: Database[] = [];
after(async () => {
  for (const d of open) await d.close();
});

/** A database exactly as the MVP left it: only migration 0001 applied, with realistic data. */
async function mvpDatabase() {
  const d = await connectDb();
  open.push(d);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsis-0001-"));
  fs.copyFileSync(path.join(MIGRATIONS_DIR, "0001_baseline.sql"), path.join(dir, "0001_baseline.sql"));
  await migrate(d, { dir, ...quiet });
  await d.exec(`
    INSERT INTO users (name, role) VALUES ('Fayaas', 'data collection'), ('Akash', 'outreach');
    INSERT INTO sources (kind, label) VALUES ('seed', 'Legacy prototype dataset (unverified)');
    INSERT INTO organizations (name, normalized_name, org_type, sector, address, area, pincode, geom, website, phone, source_id, data_confidence, field_sources, intelligence)
    VALUES
      ('Peenya Industrial Association Hub', 'peenya industrial association hub', 'Manufacturing', NULL, 'Plot 24, Peenya', 'Peenya', '560058',
        ST_SetSRID(ST_MakePoint(77.5192, 13.0285), 4326)::geography, 'https://peenyaindustrial.org', NULL, 1, 'Low',
        '{"name":{"provenance":"Unverified","source":"Legacy prototype dataset (unverified)"}}', '{"potential":"High","provenance":"AI Inference"}'),
      ('Alliance University Anekal Campus', 'alliance university anekal campus', 'College / University', NULL, '15, Main Rd', 'Anekal', NULL,
        ST_SetSRID(ST_MakePoint(77.69, 12.73), 4326)::geography, NULL, NULL, 1, 'Low', '{}', '{}'),
      ('Old Hostel Trust', 'old hostel trust', 'Hostel', NULL, NULL, NULL, NULL, NULL, NULL, '+91 98450 12345', NULL, 'Unknown', '{}', '{}');
    INSERT INTO contacts (organization_id, name, designation, is_primary) VALUES (1, 'R. Kumar', 'Plant Head', TRUE);
    INSERT INTO crm_opportunities (organization_id, owner_id, status, call_status, proposal_status, proposal_sent_at, notes, next_follow_up)
    VALUES (2, 2, 'Proposal Sent', 'Call Completed', 'Sent', now() - interval '6 days', 'Campus STP', '2026-01-05'),
           (1, NULL, 'Nurture', 'No Response', 'Not Started', NULL, NULL, NULL);
    INSERT INTO activities (organization_id, opportunity_id, type, summary) VALUES (2, 1, 'crm_added', 'Added to CRM by Fayaas'), (2, 1, 'proposal_sent', 'Proposal sent');
    INSERT INTO tasks (organization_id, opportunity_id, assigned_to, title, task_type, due_date, priority) VALUES (2, 1, 2, 'Follow up on proposal', 'Follow-up', '2026-01-05', 'High');
    INSERT INTO agent_recommendations (agent, dedupe_key, organization_id, opportunity_id, action_type, title, reason)
    VALUES ('next_action', 'next:1:follow_up_proposal:Proposal Sent', 2, 1, 'follow_up_proposal', 'Follow up with Alliance', 'Proposal sent 6 days ago');
    INSERT INTO audit_logs (actor_id, entity, entity_id, action) VALUES (1, 'organization', 1, 'create');
  `);
  return d;
}

const MVP_TABLES = ["users", "sources", "imports", "organizations", "contacts", "crm_opportunities", "activities", "tasks", "agent_recommendations", "audit_logs"];
const NEW_CRM_COLUMNS = ["pipeline", "opportunity_type", "project_id", "title", "potential", "source_water_opportunity_id"];

/** Every row of every MVP table as JSON (geometry as text), minus columns added by later migrations. */
async function snapshot(d: Database) {
  const out: Record<string, unknown[]> = {};
  for (const t of MVP_TABLES) {
    const added = t === "crm_opportunities" ? NEW_CRM_COLUMNS : t === "activities" || t === "tasks" ? ["project_id"] : [];
    const drop = added.map((c) => ` - '${c}'`).join("");
    const geomFix = t === "organizations" ? ` || jsonb_build_object('geom', ST_AsText(x.geom::geometry))` : "";
    const { rows } = await d.query<{ j: unknown }>(`SELECT (to_jsonb(x)${drop})${geomFix} AS j FROM ${t} x ORDER BY x.id`);
    out[t] = rows.map((r) => r.j);
  }
  return out;
}

test("upgrading a populated 0001 database preserves every existing row exactly", async () => {
  const d = await mvpDatabase();
  const before = await snapshot(d);
  const r = await migrate(d, quiet);
  assert.deepEqual(r.applied, loadMigrations().slice(1).map((m) => m.version));
  assert.deepEqual(await snapshot(d), before);
});

test("existing CRM opportunities land in the relationship pipeline as Customer opportunities, status untouched", async () => {
  const d = await mvpDatabase();
  await migrate(d, quiet);
  const { rows } = await d.query(`SELECT id, status, pipeline, opportunity_type, project_id, title FROM crm_opportunities ORDER BY id`);
  assert.deepEqual(rows, [
    { id: 1, status: "Proposal Sent", pipeline: "relationship", opportunity_type: "Customer", project_id: null, title: null },
    { id: 2, status: "Nurture", pipeline: "relationship", opportunity_type: "Customer", project_id: null, title: null },
  ]);
  // The MVP insert (no new columns) still works and gets the same defaults.
  await d.query(`INSERT INTO crm_opportunities (organization_id) SELECT id FROM organizations WHERE name = 'Old Hostel Trust'`);
  const n = await d.query(`SELECT pipeline, opportunity_type, status FROM crm_opportunities WHERE id = 3`);
  assert.deepEqual(n.rows[0], { pipeline: "relationship", opportunity_type: "Customer", status: "New" });
});

test("organization types: every MVP type is in the catalog; an unknown legacy type is preserved as inactive", async () => {
  const d = await mvpDatabase();
  await migrate(d, quiet);
  const { rows } = await d.query<{ name: string; active: boolean; group_key: string }>(`SELECT name, active, group_key FROM organization_types`);
  const byName = new Map(rows.map((x) => [x.name, x]));
  for (const t of ORG_TYPES) assert.ok(byName.get(t)?.active, `${t} must be an active catalog type`);
  assert.deepEqual(byName.get("Hostel"), { name: "Hostel", active: false, group_key: "other" });
  const org = await d.query(`SELECT org_type FROM organizations WHERE name = 'Old Hostel Trust'`);
  assert.equal(org.rows[0].org_type, "Hostel");
  // The new foreign key rejects types that are not in the catalog.
  await assert.rejects(d.query(`INSERT INTO organizations (name, normalized_name, org_type) VALUES ('X', 'x', 'Spaceport')`), /foreign key/);
  // Built-environment and water-ecosystem types exist.
  for (const t of ["Architect", "Architecture Firm", "Real Estate Developer", "Civil Contractor", "MEP Consultant", "Water Technology Company", "STP/WTP Provider", "NGO / Foundation", "Utility", "Research Institution"]) {
    assert.ok(byName.get(t)?.active, `${t} missing`);
  }
});

test("nothing is backfilled: no facts, projects, stakeholders or water opportunities are invented for existing data", async () => {
  const d = await mvpDatabase();
  await migrate(d, quiet);
  for (const t of ["organization_facts", "projects", "project_facts", "project_organizations", "water_opportunities"]) {
    const { rows } = await d.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
    assert.equal(rows[0].n, 0, `${t} must start empty`);
  }
});

test("pipelines: relationship stages equal the MVP statuses; project stages are exactly the approved list", async () => {
  const d = await mvpDatabase();
  await migrate(d, quiet);
  const stages = async (p: string) => (await d.query<{ name: string }>(`SELECT name FROM pipeline_stages WHERE pipeline = $1 ORDER BY sort_order`, [p])).rows.map((x) => x.name);
  assert.deepEqual(await stages("relationship"), [...CRM_STATUSES]);
  // Main track as approved in Phase 2; Lost and Nurture outcomes added in Phase 7 (migration 0010).
  assert.deepEqual(await stages("project"), ["Identified", "Research", "Contacted", "Meeting", "Technical Discussion", "Proposal", "Negotiation", "Pilot / Project", "Won", "Lost", "Nurture"]);
  const def = await d.query(`SELECT key FROM pipelines WHERE is_default`);
  assert.deepEqual(def.rows, [{ key: "relationship" }]);
  const kinds = await d.query(`SELECT pipeline, name FROM pipeline_stages WHERE kind = 'won' ORDER BY pipeline`);
  assert.deepEqual(kinds.rows, [{ pipeline: "project", name: "Won" }, { pipeline: "relationship", name: "Converted" }]);
});

test("pipeline integrity: stage must belong to the opportunity's pipeline; won stage must carry the won milestone", async () => {
  const d = await mvpDatabase();
  await migrate(d, quiet);
  await assert.rejects(d.query(`INSERT INTO crm_opportunities (organization_id, pipeline, status) VALUES (3, 'project', 'New')`), /foreign key/);
  await assert.rejects(d.query(`INSERT INTO crm_opportunities (organization_id, status) VALUES (3, 'Meeting')`), /foreign key/);
  await d.query(`INSERT INTO crm_opportunities (organization_id, pipeline, opportunity_type, status) VALUES (3, 'project', 'Project Opportunity', 'Identified')`);
  await assert.rejects(d.query(`INSERT INTO pipeline_stages (pipeline, name, sort_order, kind) VALUES ('project', 'Closed won', 95, 'won')`), /check constraint/);
  await assert.rejects(d.query(`INSERT INTO pipeline_stages (pipeline, name, sort_order, milestone) VALUES ('project', 'Second meeting', 45, 'meeting')`), /duplicate key/);
  await assert.rejects(d.query(`UPDATE pipelines SET is_default = TRUE WHERE key = 'project'`), /duplicate key/);
});

test("0009: Phase 2 water statuses map onto the review model without losing reviewers or CRM links", async () => {
  const d = await connectDb();
  open.push(d);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsis-0008-"));
  for (const m of loadMigrations().filter((x) => x.version <= "0008")) fs.copyFileSync(path.join(MIGRATIONS_DIR, m.file), path.join(dir, m.file));
  await migrate(d, { dir, ...quiet });
  await d.exec(`
    INSERT INTO users (name) VALUES ('Fayaas');
    INSERT INTO organizations (name, normalized_name, org_type) VALUES ('Synthetic Org', 'synthetic org', 'Hospital');
    INSERT INTO crm_opportunities (organization_id, status) VALUES (1, 'New');
    INSERT INTO water_opportunities (organization_id, intervention_type, reason, provenance, status, reviewed_by, reviewed_at, crm_opportunity_id) VALUES
      (1, 'STP', 'a', 'Verified', 'suggested', NULL, NULL, NULL),
      (1, 'Leak Detection', 'b', 'Verified', 'approved', 1, now(), 1),
      (1, 'Water Efficiency', 'c', 'Verified', 'pursuing', 1, now(), NULL),
      (1, 'Greywater Reuse', 'd', 'Verified', 'won', 1, now(), 1),
      (1, 'Sewage Reuse', 'e', 'Verified', 'dropped', 1, now(), NULL);
  `);
  await migrate(d, quiet);
  const { rows } = await d.query(`SELECT intervention_type, status, outcome, reviewed_by, crm_opportunity_id FROM water_opportunities ORDER BY id`);
  assert.deepEqual(rows, [
    { intervention_type: "STP", status: "suggested", outcome: null, reviewed_by: null, crm_opportunity_id: null },
    { intervention_type: "Leak Detection", status: "converted", outcome: null, reviewed_by: 1, crm_opportunity_id: 1 },
    { intervention_type: "Water Efficiency", status: "approved", outcome: null, reviewed_by: 1, crm_opportunity_id: null },
    { intervention_type: "Greywater Reuse", status: "closed", outcome: "won", reviewed_by: 1, crm_opportunity_id: 1 },
    { intervention_type: "Sewage Reuse", status: "closed", outcome: "not_pursued", reviewed_by: 1, crm_opportunity_id: null },
  ]);
  const keys = (await d.query<{ key: string }>(`SELECT key FROM water_intervention_types ORDER BY key`)).rows.map((r) => r.key);
  assert.ok(keys.includes("stp") && keys.includes("alternative_water_supply"));
});
