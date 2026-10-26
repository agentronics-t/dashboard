// Team seats per plan (Free 1, Starter 2, Pro 5, Enterprise unlimited),
// enforced by Clerk: a team workspace is a Clerk organization, and its
// maxAllowedMemberships is the plan's seat count, so Clerk itself refuses
// invitations past the limit. Call syncSeats whenever a workspace's plan changes.
import "server-only";
import { eq } from "drizzle-orm";
import { PLANS, type PlanId } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { db } from "./tenant";

/** Clerk treats 0 as "no limit". */
const clerkLimit = (seats: number | null) => seats ?? 0;

export async function syncSeats(tenantId: string, plan: PlanId): Promise<void> {
  if (!process.env.CLERK_SECRET_KEY) return;
  const [tenant] = await db().select({ orgKey: schema.tenants.clerkOrgId }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  // Personal workspaces ("user:…") have exactly one seat by definition.
  if (!tenant?.orgKey?.startsWith("org_")) return;
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    await client.organizations.updateOrganization(tenant.orgKey, { maxAllowedMemberships: clerkLimit(PLANS[plan].limits.seats) });
  } catch (err) {
    // Never fail a payment or webhook over this; the next plan change retries.
    console.error("seat sync failed", { tenantId, plan, err: err instanceof Error ? err.message : String(err) });
  }
}

/** Seats used and allowed for the active workspace (for the Team page). */
export async function seatUsage(orgId: string | null | undefined, plan: PlanId): Promise<{ used: number; limit: number | null }> {
  const limit = PLANS[plan].limits.seats;
  if (!orgId || !process.env.CLERK_SECRET_KEY) return { used: 1, limit };
  const { clerkClient } = await import("@clerk/nextjs/server");
  const client = await clerkClient();
  const org = await client.organizations.getOrganization({ organizationId: orgId });
  return { used: org.membersCount ?? 1, limit };
}
