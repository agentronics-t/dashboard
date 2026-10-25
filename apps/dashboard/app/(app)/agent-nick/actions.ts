"use server";

import { revalidatePath } from "next/cache";
import { NickError, nickFetch } from "@/lib/agentNick";
import { getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";

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

export type SiteFixKind = "llms-txt" | "sitemap" | "structured-data";

export async function submitReview(
  runId: string,
  tools: { id: string; approved: boolean; auth: "public" | "signed_in" | "scoped" }[],
  site: { siteFiles: { kind: SiteFixKind; approved: boolean }[]; siteUrl: string | null } = { siteFiles: [], siteUrl: null }
): Promise<ActionResult> {
  return guard(async (tenantId) => {
    await nickFetch(`/v1/runs/${runId}/review`, { method: "POST", body: { tools, ...site }, tenantId });
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
