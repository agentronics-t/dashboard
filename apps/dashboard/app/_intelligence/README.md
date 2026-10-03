# Retired: intelligence platform (unreachable, code kept)

Agentronics pivoted to agent authentication on 2026-09-30. The intelligence
platform (Overview/Forecast/Insights/Plugins/Agent Chat pages and the
chat/connectors/imports API routes) was moved here, into a Next.js **private
folder** — anything under an `_`-prefixed folder is excluded from routing, so
none of these URLs resolve. The code still type-checks with the rest of the app.

To restore a route, `git mv` its folder back under `app/(app)/` (pages) or
`app/api/` (route handlers) and re-add its nav entry in `components/Sidebar.tsx`.
