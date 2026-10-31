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
 * Resolve the active tenant: the signed-in person's own workspace
 * (tenants.clerk_org_id = "user:<id>"), created the first time. Without Clerk,
 * the demo tenant is used so the dashboard works in dev. There are no team
 * workspaces: a Clerk organization still active in someone's session is
 * ignored, after its data has moved into their workspace (workspaceMerge.ts).
 * intel-api and Agent Nic resolve the same tenant from the session token.
 *
 * Every page and action calls this, so it reads first (one indexed SELECT) and
 * only writes for a brand-new workspace, and React's cache() runs it once per
 * request however many components ask.
 */
export const getTenantId = cache(async (): Promise<string> => {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return DEMO_TENANT_ID;

  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId, orgRole } = await auth();
  // The middleware protects every page; never fall back to shared data.
  if (!userId) redirect("/sign-in");
  const key = `user:${userId}`;

  const started = Date.now();
  const [existing] = await db()
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.clerkOrgId, key))
    .limit(1);
  // The first query of a page: slow here means the database was waking up (Neon
  // scales to zero after 5 idle minutes) or a new connection was opened.
  const ms = Date.now() - started;
  if (ms > 400) console.warn(`[slow-db] workspace lookup took ${ms} ms`);
  const id =
    existing?.id ??
    (
      await db()
        .insert(schema.tenants)
        .values({ name: key, clerkOrgId: key })
        .onConflictDoUpdate({ target: schema.tenants.clerkOrgId, set: { clerkOrgId: key } })
        .returning({ id: schema.tenants.id })
    )[0]!.id;
  // Only the organization's admin takes its data (once; later calls find nothing to move).
  if (orgId && orgRole === "org:admin") await (await import("./workspaceMerge")).mergeOrgWorkspace(orgId, id);
  return id;
});

/**
 * Server-action guard for workspace-changing operations (keys, billing):
 * requires a signed-in user. Without Clerk (local dev) the demo tenant is allowed.
 */
export async function requireWorkspaceAdmin(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return;
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) throw new Error("unauthenticated");
}
