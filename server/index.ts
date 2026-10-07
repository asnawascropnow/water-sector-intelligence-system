import "dotenv/config";
import { claimPgliteDataDir, initDb, db } from "./db";
import { seed } from "./db/seed";
import { createApp } from "./app";
import { refreshRecommendations } from "./agents/runner";

const PORT = Number(process.env.API_PORT || process.env.PORT || 3001);

async function main() {
  claimPgliteDataDir();
  const database = await initDb(); // connects and applies pending migrations
  await seed(database);
  console.log(`[db] ${database.kind === "postgres" ? "PostgreSQL (DATABASE_URL)" : "embedded PGlite + PostGIS (.data/pglite)"} ready`);

  createApp().listen(PORT, () => console.log(`[api] listening on http://localhost:${PORT}`));

  // Daily Reminder / Next Action agents: refresh recommendations on start and every hour.
  const tick = () => refreshRecommendations(db()).catch((e) => console.error("[agents]", e));
  tick();
  setInterval(tick, 60 * 60 * 1000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
