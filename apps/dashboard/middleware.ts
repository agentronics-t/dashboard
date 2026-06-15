import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Clerk is optional in dev: with no publishable key we no-op (demo tenant).
// With keys present, everything except the sign-in/up pages requires a session
// (users arrive here already signed in from the landing page, or get the
// dashboard-hosted sign-in as a fallback).
const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default hasClerk
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublic(req)) await auth.protect();
    })
  : () => undefined;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"]
};
