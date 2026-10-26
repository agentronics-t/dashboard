"use client";

import { OrganizationProfile, OrganizationSwitcher } from "@clerk/nextjs";

/**
 * Clerk's team UI: switch between your personal workspace and teams, create a
 * team, and (inside a team) invite and manage members. The plan's seat limit
 * is enforced by Clerk (see lib/seats.ts), so invites past it are refused.
 */
export function TeamManager({ inTeam }: { inTeam: boolean }) {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <OrganizationSwitcher
          hidePersonal={false}
          afterCreateOrganizationUrl="/team"
          afterSelectOrganizationUrl="/team"
          afterSelectPersonalUrl="/team"
          appearance={{ elements: { rootBox: { display: "inline-flex" } } }}
        />
      </div>
      {inTeam && <OrganizationProfile routing="hash" />}
    </div>
  );
}
