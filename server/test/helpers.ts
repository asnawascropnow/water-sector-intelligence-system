import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { closeDb, db, initDb } from "../db";
import { seed } from "../db/seed";
import { createApp } from "../app";

/**
 * Test database selection:
 * - default: a fresh in-memory PGlite + PostGIS database per test file;
 * - TEST_DATABASE_URL set: real PostgreSQL + PostGIS. Each run gets its own throwaway schema
 *   (search_path=<schema>,public) which is dropped afterwards, so an existing database is never touched.
 */
export async function useTestDatabase(): Promise<{ cleanup: () => Promise<void>; kind: "pglite" | "postgres" }> {
  process.env.GEOCODER = "none"; // no network in tests
  delete process.env.GEMINI_API_KEY;
  const pgUrl = process.env.TEST_DATABASE_URL;
  if (!pgUrl) {
    delete process.env.DATABASE_URL;
    process.env.PGLITE_DATA_DIR = "memory://";
    await initDb();
    return { kind: "pglite", cleanup: () => closeDb() };
  }
  const pg = (await import("pg")).default;
  const schema = `wsis_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: pgUrl });
  await admin.connect();
  await admin.query("CREATE EXTENSION IF NOT EXISTS postgis");
  await admin.query(`CREATE SCHEMA ${schema}`);
  const u = new URL(pgUrl);
  u.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = u.toString();
  await initDb();
  return {
    kind: "postgres",
    cleanup: async () => {
      await closeDb();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

export interface TestApi {
  base: string;
  /** JSON request helper. Returns status and parsed body. Acts as user 1 (Fayaas) unless `user` is given. */
  call: <T = any>(method: string, path: string, body?: unknown, user?: number) => Promise<{ status: number; body: T }>;
  upload: <T = any>(path: string, filename: string, content: string | Buffer, user?: number) => Promise<{ status: number; body: T }>;
  close: () => Promise<void>;
}

export async function startTestApi(opts: { demoData?: boolean } = {}): Promise<TestApi> {
  if (!opts.demoData) process.env.SEED_DEMO_DATA = "false";
  const database = await useTestDatabase();
  await seed(db());
  const server: Server = await new Promise((resolve) => {
    const s = createApp({ staticDir: null }).listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  const call: TestApi["call"] = async (method, path, body, user = 1) => {
    const headers: Record<string, string> = { "x-user-id": String(user) };
    let payload: string | undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers, body: payload });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const upload: TestApi["upload"] = async (path, filename, content, user = 1) => {
    const fd = new FormData();
    fd.append("file", new Blob([typeof content === "string" ? content : new Uint8Array(content)]), filename);
    const res = await fetch(base + path, { method: "POST", headers: { "x-user-id": String(user) }, body: fd });
    return { status: res.status, body: await res.json() };
  };
  return {
    base,
    call,
    upload,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await database.cleanup();
    },
  };
}

/** Poll an import until extraction finishes. */
export async function waitForImport(api: TestApi, id: number) {
  for (let i = 0; i < 100; i++) {
    const { body } = await api.call("GET", `/imports/${id}`);
    if (body.status !== "processing") return body;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`import ${id} did not finish`);
}
