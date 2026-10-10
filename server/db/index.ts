import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate";

// A minimal query interface shared by node-postgres and PGlite so the rest of the
// server is written once against plain PostgreSQL + PostGIS SQL.
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** Connection handed to a transaction callback; can also run parameterless multi-statement scripts. */
export interface TxClient extends Queryable {
  exec(sql: string): Promise<void>;
}

export interface Database extends Queryable {
  kind: "postgres" | "pglite";
  tx<T>(fn: (q: TxClient) => Promise<T>): Promise<T>;
  /** Run a multi-statement script without parameters (schema migrations). */
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const DATE_OID = 1082;

async function createPostgres(url: string): Promise<Database> {
  const pg = (await import("pg")).default;
  pg.types.setTypeParser(DATE_OID, (v: string) => v); // keep DATE as 'YYYY-MM-DD'
  pg.types.setTypeParser(20, (v: string) => Number(v)); // bigint counts → number
  pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric → number
  const pool = new pg.Pool({ connectionString: url });
  return {
    kind: "postgres",
    query: (sql, params) => pool.query(sql, params as any[]) as any,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: (s, p) => client.query(s, p as any[]) as any,
          exec: async (s) => {
            await client.query(s);
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

async function createPglite(dataDir: string): Promise<Database> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { postgis } = await import("@electric-sql/pglite-postgis");
  if (!dataDir.startsWith("memory://")) fs.mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create({
    dataDir,
    extensions: { postgis },
    parsers: { [DATE_OID]: (v: string) => v, 1700: (v: string) => Number(v) },
  });
  return {
    kind: "pglite",
    query: (sql, params) => db.query(sql, params as any[]) as any,
    tx: (fn) =>
      db.transaction((t) =>
        fn({
          query: (s, p) => t.query(s, p as any[]) as any,
          exec: async (s) => {
            await t.exec(s);
          },
        }),
      ),
    exec: async (sql) => {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

let instance: Database | null = null;

/** Directory of the embedded PGlite database, or null when PostgreSQL (DATABASE_URL) or an in-memory database is used. */
export function pgliteDataDir(): string | null {
  if (process.env.DATABASE_URL) return null;
  const dir = process.env.PGLITE_DATA_DIR || path.resolve(here, "../../.data/pglite");
  return dir.startsWith("memory://") ? null : dir;
}

/**
 * PGlite is single-process: two processes opening the same data directory can corrupt it. The API
 * server records its PID in "<dataDir>.server.pid"; tools such as `npm run migrate` call this first
 * and refuse to open the directory while that server is alive.
 */
export function assertPgliteNotInUse(): void {
  const dir = pgliteDataDir();
  if (!dir) return;
  const lock = `${dir}.server.pid`;
  if (!fs.existsSync(lock)) return;
  const pid = Number(fs.readFileSync(lock, "utf8"));
  if (!pid || pid === process.pid) return;
  try {
    process.kill(pid, 0);
  } catch {
    return; // stale lock: that process is gone
  }
  throw new Error(
    `The embedded database at ${dir} is in use by the API server (pid ${pid}). Stop the server first, ` +
      `or check GET /api/system (schemaVersion) while it runs. The server applies pending migrations itself on start.`,
  );
}

/** Record this process as the PGlite owner (API server only). Removed on exit. */
export function claimPgliteDataDir(): void {
  const dir = pgliteDataDir();
  if (!dir) return;
  const lock = `${dir}.server.pid`;
  fs.writeFileSync(lock, String(process.pid));
  const release = () => {
    try {
      if (Number(fs.readFileSync(lock, "utf8")) === process.pid) fs.unlinkSync(lock);
    } catch {
      /* already gone */
    }
  };
  process.once("exit", release);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      release();
      process.exit(0);
    });
  }
}

/** Open the database (PostgreSQL when DATABASE_URL is set, otherwise embedded PGlite) without migrating. */
export async function connectDb(): Promise<Database> {
  const url = process.env.DATABASE_URL;
  return url
    ? createPostgres(url)
    : createPglite(process.env.PGLITE_DATA_DIR || path.resolve(here, "../../.data/pglite"));
}

/** Open the shared database instance and bring its schema up to date. */
export async function initDb(): Promise<Database> {
  if (instance) return instance;
  const database = await connectDb();
  await migrate(database);
  instance = database;
  return instance;
}

/** Close the shared instance (used by tests and graceful shutdown). */
export async function closeDb(): Promise<void> {
  const d = instance;
  instance = null;
  if (d) await d.close();
}

export function db(): Database {
  if (!instance) throw new Error("Database not initialised");
  return instance;
}
