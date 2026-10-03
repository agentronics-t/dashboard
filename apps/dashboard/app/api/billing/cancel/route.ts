import { billingContext, errorResponse, json } from "@/lib/billing/http";
import { cancelAtCycleEnd } from "@/lib/billing/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cancel at the end of the paid period (the plan stays until then). */
export async function POST(req: Request) {
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return json(415, { error: "json_required" });
  }
  const ctx = await billingContext();
  if (ctx instanceof Response) return ctx;
  try {
    const plan = await cancelAtCycleEnd(ctx, ctx.tenantId);
    return json(200, { tier: plan.tier, cancelAtCycleEnd: plan.cancelAtCycleEnd });
  } catch (e) {
    return errorResponse(e);
  }
}
