import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./index";
import type { OrgType } from "../../shared/constants";
import { createSource } from "../lib/log";
import { insertOrganization } from "../lib/organizations";
import { extractArea } from "../lib/normalize";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * First-run seed: team users, plus (optionally) the Bengaluru organizations carried over from the
 * earlier prototype. Those records are labelled "Unverified" / Low confidence — only name, type,
 * address, location and website were kept; the prototype's invented phone numbers, emails and
 * water estimates were dropped.
 */
export async function seed(db: Database) {
  const { rows: users } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM users`);
  if (!users[0].n) {
    await db.query(`INSERT INTO users (name, role) VALUES ('Fayaas', 'data collection'), ('Akash', 'outreach')`);
    console.log("[seed] created users Fayaas and Akash");
  }
  const { rows: orgs } = await db.query<{ n: number }>(`SELECT count(*)::int n FROM organizations`);
  if (orgs[0].n || process.env.SEED_DEMO_DATA === "false") return;

  const data = JSON.parse(fs.readFileSync(path.join(here, "seed/bengaluru-organizations.json"), "utf8")) as {
    name: string; org_type: OrgType; address: string | null; pincode: string | null; lat: number; lng: number; website: string | null;
  }[];
  const label = "Legacy prototype dataset (unverified)";
  await db.tx(async (q) => {
    const sourceId = await createSource(q, { kind: "seed", label });
    for (const o of data) {
      const u = { provenance: "Unverified" as const, source: label };
      await insertOrganization(
        q,
        { ...o, area: extractArea(`${o.name} ${o.address ?? ""}`), city: "Bengaluru" },
        {
          fieldSources: { name: u, org_type: u, address: u, location: u, ...(o.website ? { website: u } : {}) },
          sourceId,
          actorId: null,
          activitySummary: `Organization added from ${label}`,
        },
      );
    }
    await q.query(`UPDATE organizations SET data_confidence = 'Low' WHERE source_id = $1`, [sourceId]);
  });
  console.log(`[seed] loaded ${data.length} Bengaluru organizations (${label})`);
}
