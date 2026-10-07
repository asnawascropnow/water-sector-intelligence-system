import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./index";

/**
 * Versioned SQL migrations.
 *
 * - Files live in server/db/migrations and are named NNNN_description.sql (e.g. 0002_org_types.sql).
 * - They run in version order, each inside its own transaction, and are recorded in schema_migrations
 *   together with a SHA-256 checksum of the file.
 * - An applied migration is immutable: if its file changes later, startup fails loudly instead of
 *   silently diverging. Fix forward with a new migration.
 * - On real PostgreSQL a transaction-scoped advisory lock serialises concurrent starts; PGlite is
 *   single-connection so no lock is needed.
 * - Works identically on PostgreSQL + PostGIS and on PGlite + PostGIS.
 */

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const LOCK_KEY = 727_274_001; // arbitrary constant for pg_advisory_xact_lock

export interface Migration {
  version: string;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s.replace(/\r\n/g, "\n")).digest("hex");

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const seen = new Set<string>();
  return files.map((file) => {
    const m = file.match(FILE_PATTERN);
    if (!m) throw new Error(`Invalid migration file name "${file}" — expected NNNN_description.sql`);
    if (seen.has(m[1])) throw new Error(`Duplicate migration version ${m[1]}`);
    seen.add(m[1]);
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    return { version: m[1], name: m[2], file, sql, checksum: sha256(sql) };
  });
}

async function ensureTable(database: Database) {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export async function appliedMigrations(database: Database): Promise<Map<string, { name: string; checksum: string; applied_at: string }>> {
  await ensureTable(database);
  const { rows } = await database.query<{ version: string; name: string; checksum: string; applied_at: string }>(
    `SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version`,
  );
  return new Map(rows.map((r) => [r.version, r]));
}

export async function migrate(database: Database, opts: { dir?: string; log?: (msg: string) => void } = {}): Promise<MigrationResult> {
  const log = opts.log ?? ((m: string) => console.log(`[migrate] ${m}`));
  const migrations = loadMigrations(opts.dir);
  const applied = await appliedMigrations(database);

  // Integrity: every recorded migration must still exist unchanged.
  for (const [version, row] of applied) {
    const file = migrations.find((m) => m.version === version);
    if (!file) throw new Error(`Migration ${version} (${row.name}) is recorded as applied but its file is missing`);
    if (file.checksum !== row.checksum) {
      throw new Error(`Migration ${file.file} was modified after it was applied (checksum mismatch). Add a new migration instead of editing an applied one.`);
    }
  }

  const result: MigrationResult = { applied: [], alreadyApplied: [...applied.keys()] };
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const ran = await database.tx(async (t) => {
      if (database.kind === "postgres") await t.query(`SELECT pg_advisory_xact_lock($1)`, [LOCK_KEY]);
      // Re-check inside the lock: another process may have applied it meanwhile.
      const { rows } = await t.query(`SELECT 1 FROM schema_migrations WHERE version = $1`, [m.version]);
      if (rows.length) return false;
      await t.exec(m.sql);
      await t.query(`INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)`, [m.version, m.name, m.checksum]);
      return true;
    });
    if (ran) {
      result.applied.push(m.version);
      log(`applied ${m.file}`);
    }
  }
  if (!result.applied.length) log(`schema up to date (${migrations.length} migration${migrations.length === 1 ? "" : "s"})`);
  return result;
}
