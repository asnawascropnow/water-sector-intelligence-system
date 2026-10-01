import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { initDb, db } from "./db";
import { seed } from "./db/seed";
import { HttpError } from "./lib/http";
import { organizationsRouter } from "./routes/organizations";
import { importsRouter } from "./routes/imports";
import { crmRouter } from "./routes/crm";
import { tasksRouter } from "./routes/tasks";
import { aiRouter, dashboardRouter, systemRouter, usersRouter } from "./routes/misc";
import { refreshRecommendations } from "./agents/runner";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.API_PORT || process.env.PORT || 3001);

async function main() {
  const database = await initDb();
  await seed(database);
  console.log(`[db] ${database.kind === "postgres" ? "PostgreSQL (DATABASE_URL)" : "embedded PGlite + PostGIS (.data/pglite)"} ready`);

  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/organizations", organizationsRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api/crm", crmRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/system", systemRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // Production: serve the built client
  const dist = path.resolve(here, "../dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.body });
    const e = err as { code?: string; message?: string };
    if (e?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File is too large (max 15 MB)" });
    console.error(err);
    res.status(500).json({ error: e?.message || "Internal error" });
  });

  app.listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));

  // Daily Reminder / Next Action agents: refresh recommendations on start and every hour.
  const tick = () => refreshRecommendations(db()).catch((e) => console.error("[agents]", e));
  tick();
  setInterval(tick, 60 * 60 * 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
