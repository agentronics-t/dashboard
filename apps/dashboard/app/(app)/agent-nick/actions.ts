"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { schema } from "@agentronics/intel-schema/db";
import { NickError, nickFetch } from "@/lib/agentNick";
import { dodo, isPlanId, planProductId } from "@/lib/billing";
import { db, getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string; code?: string };

async function guard<T extends object>(fn: (tenantId: string) => Promise<T>): Promise<ActionResult<T>> {
  try {
    await requireWorkspaceAdmin();
    const tenantId = await getTenantId();
    return { ok: true, ...(await fn(tenantId)) };
  } catch (err) {
    if (err instanceof NickError) return { ok: false, error: err.message, code: err.code };
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export interface RepoOption {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  description: string | null;
  installationId: number;
  account: string;
  siteId: string | null;
}

export async function listRepos(): Promise<ActionResult<{ repos: RepoOption[] }>> {
  return guard(async (tenantId) => nickFetch<{ repos: RepoOption[] }>("/v1/github/repos", { tenantId }));
}

/** Hand a repo to Agent Nick and start the first run. */
export async function startOnRepo(installationId: number, repoId: number): Promise<ActionResult<{ runId: string }>> {
  return guard(async (tenantId) => {
    const { siteId } = await nickFetch<{ siteId: string }>("/v1/sites", { method: "POST", body: { installationId, repoId }, tenantId });
    return startRun(siteId, tenantId);
  });
}

/** Start a run; if one is already going, hand back that one instead. */
async function startRun(siteId: string, tenantId: string): Promise<{ runId: string }> {
  try {
    const out = await nickFetch<{ runId: string }>(`/v1/sites/${siteId}/runs`, { method: "POST", tenantId });
    revalidatePath("/agent-nick");
    return out;
  } catch (err) {
    if (err instanceof NickError && err.code === "run_in_progress" && typeof err.data.runId === "string") return { runId: err.data.runId };
    throw err;
  }
}

export async function rerunSite(siteId: string): Promise<ActionResult<{ runId: string }>> {
  return guard((tenantId) => startRun(siteId, tenantId));
}

export async function submitReview(
  runId: string,
  tools: { id: string; approved: boolean; auth: "public" | "signed_in" | "scoped" }[]
): Promise<ActionResult> {
  return guard(async (tenantId) => {
    await nickFetch(`/v1/runs/${runId}/review`, { method: "POST", body: { tools }, tenantId });
    revalidatePath(`/agent-nick/runs/${runId}`);
    return {};
  });
}

export async function cancelRun(runId: string): Promise<ActionResult> {
  return guard(async (tenantId) => {
    await nickFetch(`/v1/runs/${runId}/cancel`, { method: "POST", tenantId });
    revalidatePath(`/agent-nick/runs/${runId}`);
    return {};
  });
}

/** "Accept": merge the pull request on GitHub. */
export async function acceptRun(runId: string): Promise<ActionResult> {
  return guard(async (tenantId) => {
    await nickFetch(`/v1/runs/${runId}/merge`, { method: "POST", tenantId });
    revalidatePath(`/agent-nick/runs/${runId}`);
    revalidatePath("/agent-nick");
    return {};
  });
}

/** Start a Dodo checkout for a plan; Dodo returns the buyer to /agent-nick/billing/return. */
export async function startPlanCheckout(plan: string, runId: string | null): Promise<ActionResult<{ url: string }>> {
  return guard(async (tenantId) => {
    if (!isPlanId(plan)) throw new Error("Unknown plan.");
    const client = dodo();
    const productId = planProductId(plan);
    if (!client || !productId) throw new NickError(503, "billing_not_configured", "Payments aren't set up on this console yet.");
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    const back = `${origin}/agent-nick/billing/return${runId ? `?run=${encodeURIComponent(runId)}` : ""}`;
    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      metadata: { tenant_id: tenantId, plan },
      return_url: back,
      cancel_url: runId ? `${origin}/agent-nick/runs/${runId}` : `${origin}/agent-nick`,
      customization: { theme: "system" }
    });
    if (!session.checkout_url) throw new Error("Couldn't open the checkout page.");
    // Remember which checkout belongs to this workspace; confirmed on return or by webhook.
    await db()
      .insert(schema.workspacePlans)
      .values({ tenantId, plan, status: "pending", checkoutSessionId: session.session_id })
      .onConflictDoUpdate({
        target: schema.workspacePlans.tenantId,
        set: { checkoutSessionId: session.session_id, updatedAt: new Date() }
      });
    return { url: session.checkout_url };
  });
}
