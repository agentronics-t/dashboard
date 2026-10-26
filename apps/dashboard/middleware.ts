import { NextResponse } from "next/server";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Clerk is optional in dev: with no publishable key we no-op (demo tenant).
// With keys present, everything except the sign-in/up pages requires a session.
const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const isAuthPage = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);
// The Dodo webhook authenticates itself with a signature, not a session.
const isPublic = createRouteMatcher(["/api/dodo/webhook"]);

/** Where a signed-in visitor to /sign-in goes: their redirect_url if it's ours, else the console. */
function afterSignIn(url: URL): URL {
  const back = url.searchParams.get("redirect_url");
  if (back) {
    try {
      const target = new URL(back, url);
      if (target.origin === url.origin && !isAuthPath(target.pathname)) return target;
    } catch {
      // fall through
    }
  }
  return new URL("/detect", url);
}

const isAuthPath = (p: string) => p.startsWith("/sign-in") || p.startsWith("/sign-up");

export default hasClerk
  ? clerkMiddleware(async (auth, req) => {
      if (isAuthPage(req)) {
        // Already signed in: go straight to the console from the server,
        // instead of waiting for Clerk's script to load and redirect.
        const { userId } = await auth();
        if (userId) return NextResponse.redirect(afterSignIn(req.nextUrl));
        return;
      }
      if (!isPublic(req)) await auth.protect();
    })
  : () => undefined;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"]
};
