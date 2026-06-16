"use client";

import { SignOutButton } from "@clerk/nextjs";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
// After sign-out, send the user back to the landing page's sign-in (or the
// dashboard-hosted one in dev).
const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in";

export function AccountActions() {
  if (!hasClerk) return null;
  return (
    <SignOutButton redirectUrl={signInUrl}>
      <button
        style={{
          padding: "9px 16px",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-strong)",
          background: "transparent",
          color: "var(--danger)",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer"
        }}
      >
        Sign out
      </button>
    </SignOutButton>
  );
}
