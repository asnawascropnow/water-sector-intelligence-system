import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A minimal query interface shared by node-postgres and PGlite so the rest of the
// server is written once against plain PostgreSQL + PostGIS SQL.
export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database extends Queryable {
  kind: "postgres" | "pglite";
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
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
        const result = await fn({ query: (s, p) => client.query(s, p as any[]) as any });
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
    tx: (fn) => db.transaction((t) => fn({ query: (s, p) => t.query(s, p as any[]) as any })),
    exec: async (sql) => {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

let instance: Database | null = null;

export async function initDb(): Promise<Database> {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  instance = url
    ? await createPostgres(url)
    : await createPglite(process.env.PGLITE_DATA_DIR || path.resolve(here, "../../.data/pglite"));
  const schema = fs.readFileSync(path.join(here, "schema.sql"), "utf8");
  await instance.exec(schema);
  return instance;
}

export function db(): Database {
  if (!instance) throw new Error("Database not initialised");
  return instance;
}
