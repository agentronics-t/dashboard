import { createDb, schema } from "@agentronics/intel-schema/db";

/** Fixed demo tenant from the seed (used when Clerk is not configured). */
const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";

let _db: ReturnType<typeof createDb> | null = null;
export function db() {
  if (!_db) _db = createDb(process.env.DATABASE_URL);
  return _db;
}

/**
 * Resolve the active tenant. With Clerk configured, maps the user's org (or a
 * per-user tenant) to tenants.clerk_org_id, bootstrapping the row on first
 * sight — mirroring intel-api's tenant resolution. Without Clerk, the demo
 * tenant is used so the dashboard works in dev.
 */
export async function getTenantId(): Promise<string> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return DEMO_TENANT_ID;

  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId } = await auth();
  if (!userId) return DEMO_TENANT_ID;
  const orgKey = orgId ?? `user:${userId}`;

  const [tenant] = await db()
    .insert(schema.tenants)
    .values({ name: orgKey, clerkOrgId: orgKey })
    .onConflictDoUpdate({
      target: schema.tenants.clerkOrgId,
      set: { clerkOrgId: orgKey }
    })
    .returning({ id: schema.tenants.id });

  return (tenant as { id: string } | undefined)?.id ?? DEMO_TENANT_ID;
}
