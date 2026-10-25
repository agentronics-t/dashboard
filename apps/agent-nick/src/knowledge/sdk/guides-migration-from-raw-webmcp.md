# Migrating from raw WebMCP

If your site already calls `document.modelContext.registerTool(...)`, Agentronics wraps that surface — it doesn't replace your tools. You keep your implementations and gain detection, authentication, authorization (including *review*), per-tool status, procedural memory and observability.

## What changes

| Stays the same | Now goes through Agentronics |
|---|---|
| `name`, `title`, `description`, `inputSchema`, `annotations` | Each call is checked against your rules first (allow / review / deny) |
| Your `execute` logic and return values | The session is attributed to the agent that called |
| WebMCP agents keep working unchanged | Registration status and call outcomes are traced to the console |
| | Approved descriptions from the console can replace the text agents see |

## Pattern 1 — move registrations into the SDK

Before:

```ts
const controller = new AbortController()
await document.modelContext.registerTool(
  {
    name: 'add_to_cart',
    title: 'Add to cart',
    description: 'Add a product to the cart.',
    inputSchema: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
    async execute({ productId }, { signal }) {
      await addToCart(productId, { signal })
      return { ok: true }
    },
  },
  { signal: controller.signal }
)
```

After:

```ts
import { Agentronics } from '@agentronics/sdk'

const client = Agentronics.init({ publishableKey: 'agtx_pk_live_…', siteId: 'shop', policies, toolDescriptions })

client.registerTool({
  name: 'add_to_cart',
  title: 'Add to cart',
  description: 'Add a product to the cart.',
  inputSchema: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
  async execute({ productId }, { identity, signal }) {
    await addToCart(productId, { signal })
    return { ok: true }
  },
})

const { registrations } = client.publishToWebMcp()
// → [{ name: 'add_to_cart', status: 'callable' }]
```

The SDK owns the `AbortController`s: it unregisters and re-registers when the set of tools a given agent may see changes. Drop your own `registerTool` calls once a tool moves over.

## Pattern 2 — keep your registrations, add a policy check

If your registration code is hard to move, call `evaluate()` inside `execute`:

```ts
await document.modelContext.registerTool({
  name: 'add_to_cart',
  description: '…',
  async execute(input) {
    const decision = await client.evaluate('add_to_cart')
    if (decision.decision === 'deny') throw new Error(decision.reason)
    // decision.decision === 'review': ask the person yourself before continuing
    await addToCart(input.productId)
    client.notifyToolInvoked('add_to_cart')
    return { ok: true }
  },
})
```

You keep policy enforcement and traces, but lose automatic review prompts, per-tool status, approved descriptions and identity-based surfacing.

## Pattern 3 — agents that click instead of calling tools

Browser-automation and vision agents use your UI directly. Mark the controls and install the enforcer:

```tsx
client.installDomEnforcer()

<button data-agentronics-tool="checkout">Pay now</button>
```

Rules for `checkout` now apply to clicks from those agents too.

## Declarative forms

The declarative API (`<form toolname tooldescription>`) was removed from the WebMCP spec in October 2026 and is only an explainer now. If you used it, register those forms as imperative tools that fill and submit the form — Agent Nic generates exactly that when it writes tools for your repo.
