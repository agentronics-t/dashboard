# Authorization

Detection tells you what the agent is. Authentication tells you who it is. **Authorization decides what it may do** — tool by tool.

| Decision | What happens |
|---|---|
| `allow` | The tool runs. |
| `review` | The person on the page is asked first. The tool runs only if they approve. |
| `deny` | The tool can't be called by that agent. It gets an explanatory error — and can still use the rest of your site. |

**No rule means `allow`.** A tool is callable by any agent until you restrict it. Agentronics never blocks browsing; `deny` only ever applies to a tool call.

## Rules

Rules are evaluated in order; the first matching rule wins.

```ts
import type { PolicyRule } from '@agentronics/protocol'

const policies: PolicyRule[] = [
  { id: 'checkout', tool: 'checkout', minTrust: 'verified', allowedClasses: ['webmcp'], decision: 'review', rateLimit: { max: 3, windowSeconds: 60 } },
  { id: 'cart', tool: 'cart.*', minTrust: 'declared', allowedClasses: [], decision: 'allow' },
  { id: 'admin', tool: 'admin.*', minTrust: 'detected', allowedClasses: [], decision: 'deny' },
]
```

- **`tool`** — a name, or a glob with `*` (`cart.*`, `*`).
- **`minTrust`** — the agent's [trust](/docs/concepts/trust-levels) must be at least this (`detected < declared < verified < linked`). `linked` means a verified agent acting for a signed-in user.
- **`allowedClasses`** — if non-empty, only these agent classes (`webmcp`, `dom`, `screenshot`, `crawler`).
- **`decision`** — returned when the rule matches and the agent passes trust and class. If it doesn't pass, the call is denied with the reason.
- **`rateLimit`** — calls per agent per window, after trust and class pass.

## Manage rules in the console

Non-engineers can edit rules on the console's **Authz** page — per tool, per site or for all sites — without a deploy. Your server pulls them and hands them to the browser SDK:

```ts
// server (e.g. a Next.js layout or route)
const { policies, toolDescriptions } = await sync.pullConfig()

// browser
const client = Agentronics.init({ publishableKey, policies, toolDescriptions })
```

Site-specific rules beat all-sites rules for the same tool, and specific names beat globs. Your plan sets how many rules you can keep (Starter 5, Pro unlimited).

## Review: asking the person

When a rule says `review`, the SDK shows the visitor a small dialog — *“ChatGPT agent wants to pay the invoice. Allow / Not now”* — with the first few input values. Escape, *Not now*, or two minutes without an answer refuses the call. Every review is traced (`authz.evaluated` with `metadata.review` and `approved`), and the console's Authz page counts approvals and refusals.

Use your own UI instead:

```ts
Agentronics.init({
  publishableKey,
  review: async ({ tool, title, input, identity }) => myModal.confirm(`${identity?.vendor ?? 'An agent'} wants to ${title ?? tool}`),
  // review: false → refuse every review call
})
```

On the server, with no reviewer configured, `review` calls are refused — never silently run.

## Evaluating directly

```ts
const decision = await client.evaluate('checkout')
// → { decision: 'allow' | 'deny' | 'review', ruleId, reason }
```

Tools registered with `client.registerTool()` are evaluated automatically on every call, including calls from WebMCP agents. `client.setPolicies(rules)` replaces the rules at runtime.

## Browser-side enforcement for DOM and vision agents

Agents that click instead of calling tools can be governed too. Mark the controls and install the enforcer:

```tsx
client.installDomEnforcer()

<button data-agentronics-tool="checkout">Pay now</button>
```

A denied click is cancelled with a short overlay explaining why. This is a courtesy layer — keep real authorization on your server for anything that changes data.
