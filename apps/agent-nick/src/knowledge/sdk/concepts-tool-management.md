# Tool management

You probably have far more tools than any agent should see at once. Tool management is the layer that decides — given the current agent's trust, class, and where they are in your flow — which subset to expose, and the dashboard that shows you what every tool costs an agent's context.

The point: agents stop thrashing through 60-tool menus. You ship one registry, the SDK decides what to surface, and the product UI shows you the bill.

## Register tools

```ts
client.registerTool({
  name: 'cart.add',
  title: 'Add to cart',                       // shown by browsers / agents
  group: 'cart',
  stage: 'browse',
  description: 'Add an item to the cart.',
  annotations: { readOnlyHint: false },       // WebMCP hints — see below
  inputSchema: { type: 'object', properties: { itemId: { type: 'string' } } },
  outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  authz: { minTrust: 'declared', allowedClasses: [], decision: 'allow' },
  rateLimit: { max: 3, windowSeconds: 60 },
  execute: async (input, { identity, signal }) => addItem(input, identity, { signal }),
})
```

`signal` is aborted if the agent cancels the call.

### Annotations

WebMCP tool annotations tell agents how careful to be:

| Annotation | Meaning |
|---|---|
| `readOnlyHint` | Only reads — agents may call it without asking the user. |
| `consequentialHint` | Payments, deletes, sends — the agent should confirm with the user first. |
| `untrustedContentHint` | The output includes content you didn't write (reviews, messages) — the agent should treat it as untrusted. |

`exposedTo: ['https://partner.example']` also lets agents on those origins see the tool.

`outputSchema` is optional and, like `inputSchema`, is surfaced in the dashboard (see below). `authz` is forwarded into the policy engine automatically — every governed tool produces a matching `tool:<name>` policy rule.

## Surfacing

`client.surfaceTools({ identity })` returns the visible subset for a given agent. The decision pipeline:

1. **Trust floor.** Tool's `authz.minTrust` must be ≤ identity trust.
2. **Allowed classes.** If `authz.allowedClasses` is non-empty, identity class must match.
3. **Stage gate.** If the tool has a `stage`, it must be the current stage or in `enabledStages`.
4. **Authz decision.** Tools whose authz `decision === 'deny'` never surface.

`client.explainSurfacing({ identity })` returns the same call with a `reason` string per tool, useful for debugging in the dashboard.

## Groups

Every tool can declare a `group`. `client.groupedTools({ identity })` returns the surfaced subset bucketed by group, sorted alphabetically. Groups are presentational — they help WebMCP clients render menus, but never affect surfacing decisions.

## Progression stages

Stages model where a session is in your flow. A site that has `browse` and `checkout` stages surfaces different tools at each.

```ts
const client = init({
  publishableKey,
  progression: {
    initial: 'browse',
    stages: [
      { name: 'browse', transitions: [{ on: 'cart.add', to: 'checkout' }] },
      { name: 'checkout' },
    ],
  },
  tools: [
    { name: 'cart.add', stage: 'browse', /* ... */ },
    { name: 'cart.checkout', stage: 'checkout', /* ... */ },
  ],
})

// On a successful WebMCP invocation, the SDK auto-advances. From plain
// JS callers, call `client.notifyToolInvoked('cart.add')` to nudge.
```

A stage transition emits `tool.progressed` with `{ from, to, trigger }` metadata. The next surfacing call sees the new stage.

## Publishing to WebMCP

`client.publishToWebMcp({ identity })` registers the surfaced tools with the browser, following the October 2026 WebMCP draft:

```ts
const { surfaced, registrations } = client.publishToWebMcp({ identity })
for (const r of await registrations) {
  // { name: 'cart.add', status: 'callable' } or { name: 'x', status: 'failed', error: 'TypeError: …' }
}
```

- Each tool is registered with `await document.modelContext.registerTool(tool, { signal, exposedTo })`, with its `title`, `description`, `inputSchema` and `annotations`. `navigator.modelContext` (removed in Chrome 152) and old `provideContext()` polyfills are used only as fallbacks.
- Re-publishing aborts the previous registrations (WebMCP has no `unregisterTool()` — the `AbortSignal` unregisters) and registers the new set. The SDK re-publishes by itself when the identity-gated set changes, and only then.
- Every call from an agent runs through the registry's policy pipeline, so `deny` and `review` apply to WebMCP agents too.
- The first `toolactivated` event or tool call marks the session as a WebMCP agent.

The declarative form API (`<form toolname>`) was removed from the WebMCP spec in October 2026 and lives on only as an explainer, so the SDK registers every tool imperatively.

### Tool status

Each registration is traced as `tool.surfaced` with `metadata.state` = `published` or `failed` (and the browser's error). The console's **WebMCP Tools** page turns that into a per-tool status — **Callable**, **Failed** (with the reason), **Disabled**, or **Not seen** (synced, but no browser has registered it yet) — next to call counts, errors and p95 latency from `tool.executed` traces.

## Token budget

Tool descriptions cost tokens — every surfaced tool occupies space in the agent's context. `client.estimateTokens({ identity })` returns:

```ts
{
  total: 412,
  perTool: [
    { name: 'cart.add', characters: 168, tokens: 42 },
    { name: 'cart.remove', characters: 132, tokens: 33 },
    // ...
  ],
}
```

The estimate is ≈ characters / 4 of what an agent actually receives — `name`, `title`, `description`, `inputSchema` and `annotations` (policy and grouping stay on your site and cost the agent nothing). `descriptorTokens(tool)` gives the same number for one tool; the console uses the same formula. To cut it without touching your code, see [Procedural memory](/docs/concepts/procedural-memory).

## Syncing to the dashboard

Push the full registry — each tool's `page` (stage), `group`, `title`, `description`, `annotations`, input/output schema and token cost — from your server so the console's **WebMCP Tools** page can render it:

```ts
const sync = createDashboardSync({ url: process.env.AGENTRONICS_API_URL!, ingestKey: process.env.AGENTRONICS_INGEST_KEY!, siteId: 'shop' })
await sync.pushTools(tools) // your GovernedTool[]
```

It's a cheap idempotent upsert — re-call it whenever your registry changes.

## The Tool management view

The dashboard groups the synced tools **page-wise** (by `page`/stage), and for each page shows every tool's input/output schema and token cost. Each tool renders like this:

### Context fullness, per page

The headline number on each page is **context fullness** — how much of an agent's context window the page's tools occupy *if they all load at once*. The dashboard budgets **4,000 tokens** per page; the bar fills as you add tools:

It's the same `tokens` estimate `estimateTokens()` uses, so a fat description shows up as an outlier you can trim. As a page's tools approach the budget the bar shifts amber, then red past 100% — your cue to split the page, gate tools behind a later stage, or trim descriptions.

### Worked example

A retail site has 14 tools. For a `detected`-trust visitor on `/browse`, surfacing returns the 4 read-only ones (catalog search, catalog read, reviews read, shipping estimate) — ~612 tokens, comfortably under budget. After the user signs in (`linked`) and advances to `/checkout`, the same registry surfaces 11 of 14 — ~3,120 tokens, still under 4,000 but now in the amber zone, exactly where you'd want to start trimming.

If a tool inflates `description` or `inputSchema` beyond reason, it lights up in `perTool` (and as a tall slice of the bar) as an outlier. Trim the description, or split a fat tool into two.

## Traces

| Event | When |
|---|---|
| `tool.registered` | A tool is added to the registry. |
| `tool.surfaced` | A tool was registered with WebMCP (`state: 'published'`), rejected (`'failed'`), or enabled / disabled in code. |
| `tool.executed` | A tool runs — `outcome` is `success`, `error`, or `blocked` (denied or refused in review), with `durationMs`. |
| `tool.progressed` | A stage transition fires. |

Filter for `tool.*` in the dashboard to watch the surfacing layer in real time.
