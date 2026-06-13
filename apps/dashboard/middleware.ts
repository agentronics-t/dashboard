import { clerkMiddleware } from "@clerk/nextjs/server";

// Clerk is optional in dev: with no publishable key we no-op (demo tenant).
const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default hasClerk ? clerkMiddleware() : () => undefined;

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)"]
};
