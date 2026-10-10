import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "./lib/http";
import { organizationsRouter } from "./routes/organizations";
import { importsRouter } from "./routes/imports";
import { crmRouter } from "./routes/crm";
import { tasksRouter } from "./routes/tasks";
import { projectsRouter } from "./routes/projects";
import { waterRouter } from "./routes/water";
import { aiRouter, dashboardRouter, metaRouter, systemRouter, usersRouter } from "./routes/misc";
import { emailRouter } from "./routes/email";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  /** Directory of the built client to serve (production). Defaults to ../dist when it exists; pass null to disable. */
  staticDir?: string | null;
}

/**
 * Build the Express application without starting a server or touching the database.
 * The database must already be initialised (initDb) before requests are handled.
 * Used by server/index.ts and by the API regression tests.
 */
export function createApp(opts: AppOptions = {}): Express {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/organizations", organizationsRouter);
  app.use("/api/imports", importsRouter);
  app.use("/api/crm", crmRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/projects", projectsRouter);
  app.use("/api/water-opportunities", waterRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/system", systemRouter);
  app.use("/api/meta", metaRouter);
  app.use("/api/email", emailRouter);
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  // Production: serve the built client
  const dist = opts.staticDir === undefined ? path.resolve(here, "../dist") : opts.staticDir;
  if (dist && fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.body });
    const e = err as { code?: string; message?: string; type?: string };
    if (e?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File is too large (max 15 MB)" });
    if (e?.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
    console.error(err);
    res.status(500).json({ error: e?.message || "Internal error" });
  });

  return app;
}
