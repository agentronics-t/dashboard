import { billingContext, errorResponse, json, readJson } from "@/lib/billing/http";
import { startCheckout } from "@/lib/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start a Razorpay checkout. The plan id + price are chosen server-side. */
export async function POST(req: Request) {
  const ctx = await billingContext();
  if (ctx instanceof Response) return ctx;
  const body = await readJson(req);
  if (body instanceof Response) return body;
  try {
    return json(
      200,
      await startCheckout(ctx, ctx.tenantId, ctx.userId, { plan: body.plan, cycle: body.cycle })
    );
  } catch (e) {
    return errorResponse(e);
  }
}
