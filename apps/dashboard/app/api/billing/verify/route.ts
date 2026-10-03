import { billingContext, errorResponse, json, readJson } from "@/lib/billing/http";
import { confirmCheckout } from "@/lib/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Razorpay Checkout success callback: verify the signature, re-read the subscription. */
export async function POST(req: Request) {
  const ctx = await billingContext();
  if (ctx instanceof Response) return ctx;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    return json(200, await confirmCheckout(ctx, ctx.tenantId, body));
  } catch (e) {
    return errorResponse(e);
  }
}
