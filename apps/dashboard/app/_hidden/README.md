# Hidden console pages (feature kept, not in the product)

Agentronics went all-in on agent authentication on 2026-09-30. These pages
(Detect, Auth pillar, Authz, WebMCP Tools, Knaph/site memory, Analytics) are
kept but unrouted — `_`-prefixed folders are excluded from Next.js routing.
Their replacements: Overview, Agents, Logs, Configure → Authentication /
Access rules. To restore one, `git mv` it back under `app/(app)/` and add a
nav entry in `components/Sidebar.tsx`.
