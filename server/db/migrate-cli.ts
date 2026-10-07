import "dotenv/config";
import { assertPgliteNotInUse, connectDb } from "./index";
import { appliedMigrations, loadMigrations, migrate } from "./migrate";

/**
 * npm run migrate            → apply pending migrations
 * npm run migrate -- status  → list migrations and whether each is applied
 */
async function main() {
  assertPgliteNotInUse();
  const database = await connectDb();
  try {
    if (process.argv[2] === "status") {
      const applied = await appliedMigrations(database);
      for (const m of loadMigrations()) {
        const row = applied.get(m.version);
        console.log(`${row ? "applied" : "pending"}  ${m.file}${row ? `  (${new Date(row.applied_at).toISOString()})` : ""}`);
      }
    } else {
      const r = await migrate(database);
      console.log(r.applied.length ? `Applied ${r.applied.length} migration(s): ${r.applied.join(", ")}` : "Nothing to apply.");
    }
  } finally {
    await database.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
