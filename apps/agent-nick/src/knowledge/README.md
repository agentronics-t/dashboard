# Agent Nick knowledge pack

What the model is told about WebMCP and our SDK. It is compiled into
`pack.generated.ts` by `pnpm knowledge:sync` (run it after changing anything
here) and sent as the stable prefix of every Gemini call, so Vertex's implicit
context caching makes repeat calls cheap.

| Folder | Source |
|---|---|
| `webmcp/` | Google's [modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance) WebMCP guides (`skills/modern-web-guidance/guides/webmcp/`), copied verbatim at commit `65e7edd67e77420eaf02c5df00fdc0521417d809` under the Apache-2.0 licence in `webmcp/LICENSE`. Refresh with `pnpm knowledge:sync --pull <ref>`. |
| `sdk/` | **Agentronics SDK docs — empty until the SDK rebuild ships.** Drop the SDK's docs here as `.md` files and set `SDK_CODEGEN=true`; the prompts then tell the model to register tools through the SDK instead of raw `document.modelContext`. |
