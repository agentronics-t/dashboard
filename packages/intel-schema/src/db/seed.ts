// Idempotent demo seed: fixed UUID so re-runs UPSERT instead of duplicating.
import { createDb } from "./client.js";
import { tenants } from "./schema.js";

const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

async function main() {
  const db = createDb();
  await db
    .insert(tenants)
    .values({ id: DEMO_TENANT_ID, name: "Agentronics Demo" })
    .onConflictDoUpdate({
      target: tenants.id,
      set: { name: "Agentronics Demo" }
    });

  const rows = await db.select().from(tenants);
  console.log(JSON.stringify({ seeded: DEMO_TENANT_ID, tenants: rows.length }));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
