# Agent Nic knowledge pack

What the model is told about WebMCP and our SDK. It is compiled into
`pack.generated.ts` by `pnpm knowledge:sync` (run it after changing anything
here) and sent as the stable prefix of every Gemini call, so Vertex's implicit
context caching makes repeat calls cheap.

| Folder | Source |
|---|---|
| `webmcp/` | Google's [modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance) WebMCP guides (`skills/modern-web-guidance/guides/webmcp/`), copied verbatim at commit `65e7edd67e77420eaf02c5df00fdc0521417d809` under the Apache-2.0 licence in `webmcp/LICENSE`. Refresh with `pnpm knowledge:sync --pull <ref>`. |
| `sdk/` | Agentronics SDK pages that shape the generated code (tool management, procedural memory, authorization, auth overview, migrating from raw WebMCP), converted from the SDK repo's MDX docs. Refresh with `pnpm knowledge:sync --sdk-docs <SDK>/apps/docs/content/docs`. The generated tools module stays dependency-free; customers who use the SDK pass their client to `registerAgentronicsTools(pathname, signal, client)`. |
