# Procedural memory

An agent re-reads every tool's description on every page it visits. Long, padded descriptions cost tokens on each of those reads and make it harder for the agent to choose the right tool. Procedural memory is how you keep that text tight: the console rewrites each description, shows you the before and after token counts, and — once you approve — the SDK publishes the new text to agents. Your code doesn't change.

## How it works

1. **Sync your tools** from your server (`createDashboardSync().pushTools(tools)`). The console now knows each tool's description and token cost.
2. **Write descriptions.** On the console's **Memory** page, *Write descriptions* asks Gemini to rewrite each one: start with a verb, say what the tool does and when to use it, keep side effects and whether the user must confirm, drop filler and anything already in the input schema, never invent behaviour, never get longer. Without Vertex AI configured, a rule-based pass strips the usual filler instead.
3. **Review.** Each tool shows *In your code* next to *What agents see*, with both token counts. **Approve**, **Edit** then approve, or **Keep original**. Rewriting again leaves approved descriptions alone.
4. **Serve.** Approved text comes back from `pullConfig()` as `toolDescriptions`, and the browser SDK uses it when it publishes to WebMCP:

```ts
// server
const { toolDescriptions, policies } = await sync.pullConfig()

// browser
const client = Agentronics.init({ publishableKey, toolDescriptions, policies })
client.publishToWebMcp()

// or later, without re-initialising:
client.setToolDescriptions(toolDescriptions) // re-registers the tools with the new text
```

`client.estimateTokens()` reflects the approved descriptions, so you can see the saving in your own code too.

## Token counts

Both numbers use the SDK's estimate — ≈ characters / 4 of the model-facing descriptor (`name`, `title`, `description`, `inputSchema`, `annotations`). The Memory page totals them across every tool: *tokens agents read*, and the share saved by approved rewrites.

## Site memory

Procedural memory is about *how to use your tools*. [Site memory](/docs/concepts/site-memory) is about *your site* — its pages, workflows and policies — and is served to agents through meta tags, `/.well-known/agent-context.json` and a `getSiteContext` tool. The Memory page shows both.

Procedural memory is included from the Starter plan.
