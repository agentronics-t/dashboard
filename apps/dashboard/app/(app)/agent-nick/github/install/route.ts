import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { githubAppSlug } from "@/lib/agentNick";

export const dynamic = "force-dynamic";

/** Send the user to install the Agentronics GitHub App, with a CSRF state cookie. */
export async function GET(req: Request) {
  const slug = githubAppSlug();
  const origin = new URL(req.url).origin;
  if (!slug) return NextResponse.redirect(`${origin}/agent-nick?error=github_not_configured`);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(`https://github.com/apps/${slug}/installations/new?state=${state}`);
  res.cookies.set("an_gh_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/agent-nick/github",
    maxAge: 15 * 60
  });
  return res;
}
