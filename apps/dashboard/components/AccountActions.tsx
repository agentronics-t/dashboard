"use client";

import { useClerk } from "@clerk/nextjs";
import { useState } from "react";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
// After sign-out, send the user back to the landing page's sign-in (or the
// dashboard-hosted one in dev).
const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in";

export function AccountActions() {
  if (!hasClerk) return null;
  return <SignOut />;
}

/**
 * Sign out, wait until Clerk has ended the session and cleared its cookie,
 * then load the sign-in page fresh. (Navigating before that could reach the
 * server with the old session, which sends a signed-in visitor straight back.)
 */
function SignOut() {
  const { signOut } = useClerk();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signOut();
        } finally {
          window.location.replace(signInUrl);
        }
      }}
      style={{
        padding: "9px 16px",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--border-strong)",
        background: "transparent",
        color: "var(--danger)",
        fontWeight: 600,
        fontSize: 14,
        cursor: busy ? "default" : "pointer"
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
