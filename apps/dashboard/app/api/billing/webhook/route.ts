import { NextResponse } from "next/server";
import { db } from "@/lib/tenant";
import { BillingError, applyWebhook, billingConfigFromEnv } from "@/lib/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 1024 * 1024; // Razorpay payloads are a few KB

/**
 * Razorpay webhook (public — authenticated by X-Razorpay-Signature over the
 * raw body, not by a session). Configure it in the Razorpay dashboard for the
 * subscription.* events with the secret in RAZORPAY_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const config = billingConfigFromEnv();
  if (!config) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const raw = await req.text(); // raw bytes — verify before parsing
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "too_large" }, { status: 413 });
  try {
    const outcome = await applyWebhook(
      { db: db(), config },
      raw,
      req.headers.get("x-razorpay-signature"),
      req.headers.get("x-razorpay-event-id")
    );
    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    if (e instanceof BillingError) return NextResponse.json({ error: e.code }, { status: e.status });
    console.error("[billing webhook]", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 }); // Razorpay retries
  }
}
