import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { connectDb, type Database } from "./index";
import { loadMigrations, migrate, MIGRATIONS_DIR } from "./migrate";

// Each test gets its own fresh in-memory PGlite database (or real PostgreSQL when TEST_DATABASE_URL is
// set — see server/test/helpers.ts; these low-level tests use PGlite only).
process.env.PGLITE_DATA_DIR = "memory://";
delete process.env.DATABASE_URL;

const open: Database[] = [];
async function freshDb() {
  const d = await connectDb();
  open.push(d);
  return d;
}
after(async () => {
  for (const d of open) await d.close();
});
const quiet = { log: () => undefined };

function tempDir(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wsis-migrations-"));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql);
  return dir;
}
const baselineSql = () => fs.readFileSync(path.join(MIGRATIONS_DIR, "0001_baseline.sql"), "utf8");

const CORE_TABLES = ["users", "sources", "imports", "organizations", "contacts", "crm_opportunities", "activities", "tasks", "agent_recommendations", "audit_logs"];

test("migration files are well-formed and start with the 0001 baseline", () => {
  const ms = loadMigrations();
  assert.equal(ms[0].version, "0001");
  assert.equal(ms[0].name, "baseline");
  assert.deepEqual(
    ms.map((m) => m.version),
    [...ms.map((m) => m.version)].sort(),
  );
});

const ALL = () => loadMigrations().map((m) => m.version);

test("fresh database: migrations create every MVP table and PostGIS, each recorded with its checksum", async () => {
  const d = await freshDb();
  const r = await migrate(d, quiet);
  assert.deepEqual(r.applied, ALL());
  const { rows } = await d.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()`);
  const tables = rows.map((x) => x.table_name);
  for (const t of [...CORE_TABLES, "schema_migrations"]) assert.ok(tables.includes(t), `missing table ${t}`);
  const pg = await d.query<{ v: string }>(`SELECT postgis_version() AS v`);
  assert.match(pg.rows[0].v, /^3\./);
  const rec = await d.query<{ version: string; checksum: string }>(`SELECT version, checksum FROM schema_migrations ORDER BY version`);
  assert.deepEqual(
    rec.rows.map((x) => [x.version, x.checksum]),
    loadMigrations().map((m) => [m.version, m.checksum]),
  );
});

test("running again is a no-op", async () => {
  const d = await freshDb();
  await migrate(d, quiet);
  const again = await migrate(d, quiet);
  assert.deepEqual(again.applied, []);
  assert.deepEqual(again.alreadyApplied, ALL());
});

test("adopts a database created before the migration runner existed, without touching its data", async () => {
  const d = await freshDb();
  // Simulate the old startup behaviour: schema applied directly, no schema_migrations table.
  await d.exec(baselineSql());
  await d.query(`INSERT INTO organizations (name, normalized_name) VALUES ('Legacy Org', 'legacy org')`);
  const r = await migrate(d, quiet);
  assert.deepEqual(r.applied, ALL());
  const { rows } = await d.query<{ name: string }>(`SELECT name FROM organizations`);
  assert.deepEqual(rows.map((x) => x.name), ["Legacy Org"]);
});

test("applies pending migrations in version order", async () => {
  const d = await freshDb();
  const dir = tempDir({
    "0001_baseline.sql": baselineSql(),
    "0003_third.sql": "INSERT INTO mig_order (step) VALUES ('third');",
    "0002_second.sql": "CREATE TABLE mig_order (id SERIAL PRIMARY KEY, step TEXT); INSERT INTO mig_order (step) VALUES ('second');",
  });
  const r = await migrate(d, { dir, ...quiet });
  assert.deepEqual(r.applied, ["0001", "0002", "0003"]);
  const { rows } = await d.query<{ step: string }>(`SELECT step FROM mig_order ORDER BY id`);
  assert.deepEqual(rows.map((x) => x.step), ["second", "third"]);
});

test("a failing migration rolls back completely and is not recorded", async () => {
  const d = await freshDb();
  const dir = tempDir({
    "0001_baseline.sql": baselineSql(),
    "0002_broken.sql": "CREATE TABLE half_done (id INT); SELECT this_function_does_not_exist();",
  });
  await assert.rejects(migrate(d, { dir, ...quiet }));
  const t = await d.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'half_done'`);
  assert.equal(t.rows.length, 0, "partial DDL must be rolled back");
  const v = await d.query<{ version: string }>(`SELECT version FROM schema_migrations ORDER BY version`);
  assert.deepEqual(v.rows.map((x) => x.version), ["0001"]);
});

test("refuses to start if an applied migration file was edited", async () => {
  const d = await freshDb();
  const dir = tempDir({ "0001_baseline.sql": baselineSql() });
  await migrate(d, { dir, ...quiet });
  fs.appendFileSync(path.join(dir, "0001_baseline.sql"), "\n-- sneaky edit\n");
  await assert.rejects(migrate(d, { dir, ...quiet }), /modified after it was applied/);
});

test("refuses to start if an applied migration file is missing", async () => {
  const d = await freshDb();
  const dir = tempDir({ "0001_baseline.sql": baselineSql(), "0002_extra.sql": "SELECT 1;" });
  await migrate(d, { dir, ...quiet });
  fs.unlinkSync(path.join(dir, "0002_extra.sql"));
  await assert.rejects(migrate(d, { dir, ...quiet }), /file is missing/);
});

test("rejects badly named or duplicate-version migration files", () => {
  assert.throws(() => loadMigrations(tempDir({ "1_bad.sql": "SELECT 1;" })), /Invalid migration file name/);
  assert.throws(() => loadMigrations(tempDir({ "0001_a.sql": "SELECT 1;", "0001_b.sql": "SELECT 1;" })), /Duplicate migration version/);
});
