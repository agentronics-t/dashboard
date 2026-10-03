import "server-only";
import { NextResponse } from "next/server";
import { db, getTenantId } from "@/lib/tenant";
import { BillingError, billingConfigFromEnv, type BillingConfig } from "./service.ts";
import { razorpayClient, type RazorpayClient } from "./razorpay.ts";

export const json = (status: number, body: unknown) => NextResponse.json(body, { status });

export interface BillingCtx {
  tenantId: string;
  userId: string;
  config: BillingConfig;
  rzp: RazorpayClient;
  db: ReturnType<typeof db>;
}

/**
 * Resolve an authorised billing context or an error response. Billing needs a
 * real Clerk user (never the demo tenant); in an organisation only admins may
 * change the plan.
 */
export async function billingContext(): Promise<BillingCtx | Response> {
  const config = billingConfigFromEnv();
  if (!config) return json(503, { error: "billing_not_configured" });
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return json(401, { error: "auth_not_configured" });

  const { auth } = await import("@clerk/nextjs/server");
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return json(401, { error: "unauthenticated" });
  if (orgId && orgRole !== "org:admin") return json(403, { error: "billing_admin_only" });

  return {
    tenantId: await getTenantId(),
    userId,
    config,
    rzp: razorpayClient(config.keyId, config.keySecret),
    db: db()
  };
}

/** JSON-only bodies: a cross-site form post can't be JSON without a CORS preflight. */
export async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json(415, { error: "json_required" });
  }
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : json(400, { error: "invalid_json" });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof BillingError) return json(e.status, { error: e.code, message: e.message });
  console.error("[billing]", e);
  return json(500, { error: "internal_error" });
}
