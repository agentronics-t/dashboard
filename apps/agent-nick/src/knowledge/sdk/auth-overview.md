# Authentication

Detection tells you *what kind* of agent is on the page. Authentication tells you *which agent*, and — when it acts for someone — *for whom*. Agentronics verifies four methods today, the ones agents actually use:

| Method | What it proves | Who uses it | Plan |
|---|---|---|---|
| [Verified crawlers](/docs/auth/verified-crawlers) | The crawler really belongs to its vendor — client IP inside the vendor's published ranges, or forward-confirmed reverse DNS | GPTBot, ChatGPT-User, OAI-SearchBot, PerplexityBot, Googlebot, Bingbot, … | Free |
| [Agent API keys](/docs/auth/api-keys) | A key you issued to this agent | Your own agents, partners' agents | Free |
| [Web Bot Auth](/docs/auth/web-bot-auth) | The agent's operator, by an RFC 9421 signature on every request | ChatGPT agent, Cloudflare Signed Agents (Browserbase, Anchor, Goose), anyone publishing a key directory | Starter |
| [OAuth 2.1](/docs/auth/oauth) | The agent's client — and the user it acts for, when the token is delegated | MCP clients, agents using your sign-in, token exchange | Starter |

**Authentication never blocks.** A verified agent gets an identity your code and policies can use; an agent that proves nothing — or a human — browses exactly as before. What an identity *unlocks* is up to your [authorization rules](/docs/authorization).

## Where it runs

Most agents never run your page's JavaScript, so authentication happens on your server, from the HTTP request:

```ts
// middleware.ts (Next.js)
import { agentronicsMiddleware } from '@agentronics/sdk/next'

export default agentronicsMiddleware({
  // Web Bot Auth and verified crawlers are on by default
  apiKey: { verify: sync.keyVerifier() },                         // keys minted in the console
  oauth2: { issuer: 'https://auth.shop.example', audience: 'https://shop.example' },
})
```

Your routes read the result from `x-agentronics-*` request headers (incoming copies are stripped, so they can't be forged):

```ts
import { readAgentHeaders } from '@agentronics/sdk/server'

const agent = readAgentHeaders(request.headers)
// → { status: 'verified', id: 'https://chatgpt.com', name: 'ChatGPT agent', method: 'web-bot-auth', vendor: 'OpenAI' }
```

Outside Next.js use `createAgentAuth()` (any Fetch `Request`), `createAgentAuthHandler()` or `expressAgentAuth()` from `@agentronics/sdk/server`. Methods run strongest first — Web Bot Auth, then API key / OAuth, then crawler checks — and the first that verifies wins.

## The trust ladder

| Trust | Reached by | Means |
|---|---|---|
| `detected` | Detection signals only | Probably an agent. Nothing proven. |
| `declared` | The agent named itself (UA, self-declaration, a token nothing has checked) | A claim. Treat as unverified. |
| `verified` | One of the four methods succeeded | The agent is who it says it is. |
| `linked` | A verified OAuth token acting for a signed-in user | Apply that user's permissions to the agent. |

Verified server-side identities are traced with class `crawler` (HTTP fetchers) and `metadata.protocol` set to the method, so they appear on the console's **Auth** page next to in-browser agents.

## In the browser

Agents that run inside the page (WebMCP, browser extensions) can present credentials to the browser SDK with `client.authenticate()` or `client.presentIdentity()`. The browser can't check a token on its own, so **an unchecked token is `declared`, never `verified`** — wire `auth.verifyToken` to your backend (which calls the server SDK) to upgrade it:

```ts
const client = Agentronics.init({
  publishableKey: process.env.NEXT_PUBLIC_AGENTRONICS_KEY!,
  auth: {
    verifyToken: async (method, token) => {
      const res = await fetch('/api/agentronics/verify', { method: 'POST', body: JSON.stringify({ method, token }) })
      return res.ok ? res.json() : null // a VerificationResult, or null
    },
  },
})
```

> 
  Changed in SDK 0.7: before, bearer / OAuth / session-link tokens with no verifier were reported as
  `verified`. They are now `declared` until a verifier accepts them.

## Coming later

These are built but off by default until they ship in the console:

- **Enterprise agent SSO** — ID-JAG / Cross App Access (Okta Agent SSO, Microsoft Entra Agent ID, Auth0).
- **Workload identity** — SPIFFE, including Google Agent Identity.
- **mTLS** — client certificates, server-side.

To try them in the browser SDK: `createAuthEngine({ methods: [...defaultAuthMethods(), ...previewAuthMethods()] })`.
