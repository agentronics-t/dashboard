import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { NickError, nickFetch } from "@/lib/agentNick";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * GitHub returns here after the app is installed (with "Request user
 * authorization during installation" on, so we also get an OAuth `code`).
 * The service exchanges the code and checks that this GitHub user can really
 * access `installation_id` before linking it to the workspace.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const back = (q: string) => {
    const res = NextResponse.redirect(`${url.origin}/agent-nick?${q}`);
    res.cookies.delete({ name: "an_gh_state", path: "/agent-nick/github" });
    return res;
  };
  const code = url.searchParams.get("code");
  const installationId = Number(url.searchParams.get("installation_id"));
  const state = url.searchParams.get("state");
  const cookie = req.cookies.get("an_gh_state")?.value;

  // Only finish an install this browser started (state, when GitHub echoes it, must match).
  if (!cookie || (state !== null && !same(state, cookie))) return back("error=github_state");
  if (!code || !Number.isInteger(installationId) || installationId <= 0) return back("error=github_missing_code");

  try {
    await nickFetch("/v1/github/installations", { method: "POST", body: { code, installationId }, tenantId: await getTenantId() });
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof NickError ? err.code : "github_link_failed")}`);
  }
  return back("connected=1");
}
