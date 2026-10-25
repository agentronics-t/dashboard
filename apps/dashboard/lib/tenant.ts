import { cache } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
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
 * per-user tenant) to tenants.clerk_org_id, creating the row the first time,
 * mirroring intel-api's tenant resolution. Without Clerk, the demo tenant is
 * used so the dashboard works in dev.
 *
 * Every page and action calls this, so it reads first (one indexed SELECT) and
 * only writes for a brand-new workspace, and React's cache() runs it once per
 * request however many components ask.
 */
export const getTenantId = cache(async (): Promise<string> => {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return DEMO_TENANT_ID;

  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId } = await auth();
  // The middleware protects every page; never fall back to shared data.
  if (!userId) redirect("/sign-in");
  const orgKey = orgId ?? `user:${userId}`;

  const [existing] = await db()
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.clerkOrgId, orgKey))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db()
    .insert(schema.tenants)
    .values({ name: orgKey, clerkOrgId: orgKey })
    .onConflictDoUpdate({ target: schema.tenants.clerkOrgId, set: { clerkOrgId: orgKey } })
    .returning({ id: schema.tenants.id });
  return created.id;
});

/**
 * Server-action guard for workspace-changing operations (keys, billing):
 * requires a signed-in user and, inside an organization, the admin role.
 * Without Clerk (local dev) the demo tenant is allowed.
 */
export async function requireWorkspaceAdmin(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return;
  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId, orgRole } = await auth();
  if (!userId) throw new Error("unauthenticated");
  if (orgId && orgRole !== "org:admin") throw new Error("Only organization admins can manage keys.");
}
