"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useEffect } from "react";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/**
 * Teams are gone: everyone works in their own workspace. A session that still
 * has a Clerk organization active (from before) is switched back to the
 * personal one, so every browser shows the same plan and data, and the session
 * token Agent Nic and the API see carries no organization. The server already
 * ignores it (lib/tenant.ts) and has moved that team's data over by now.
 */
export function PersonalWorkspace() {
  if (!hasClerk) return null;
  return <ClearOrganization />;
}

function ClearOrganization() {
  const { orgId, isLoaded } = useAuth();
  const { setActive } = useClerk();
  useEffect(() => {
    if (isLoaded && orgId) void setActive({ organization: null }).catch(() => {});
  }, [isLoaded, orgId, setActive]);
  return null;
}
