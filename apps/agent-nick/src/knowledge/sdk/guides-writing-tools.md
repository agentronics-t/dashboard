# Write tools agents can call

An agent picks a tool by reading its name, description and input schema, then calls it with the arguments it thinks fit. It can't see your code, can't retry with a debugger, and rereads every tool's text on every page. A tool that works only when called the way its author imagined fails for real agents.

These are the rules Agent Nic follows when it writes tools into your code, and the checks it runs before it opens a pull request. Follow them in tools you write yourself.

## Name and description

- **Name:** `snake_case`, verb first, unique on the page: `search_products`, `add_to_cart`, `book_table`.
- **Description:** one or two sentences on what the tool does and when to use it. Don't repeat what the schema already says (parameter names, types, choices, defaults, limits): agents read both, and every word costs tokens on every page.
- **Annotations:** `readOnlyHint` for tools that only read; `consequentialHint` for payments, orders, bookings, messages and anything irreversible; `untrustedContentHint` for tools that return user-written content.

## Input schema

The schema is JSON Schema with `type: "object"`.

- **Required means required.** List a field in `required` only if the tool can't do anything without it. A search box, a filter or a sort order is optional: leaving it empty is a normal call.
- **Choices (`enum`) only for fixed values.** Use `enum` when the allowed values are fixed in your code: `["price", "newest"]`. Never build an enum from what your page renders: `<option value={category.slug}>` is data, and copying it into a schema gives agents the literal text `category.slug`. Describe the field instead ("A category slug, e.g. electronics") or add a tool that lists the categories.
- **No empty choices.** An option like `<option value="">All</option>` means "leave it out", not a value: drop it from the enum and make the field optional.
- **Types an agent can produce:** `string`, `number`, `integer`, `boolean`, `array`, `object`. Put formats in the description or in `format` (`"email"`, `"date"`).
- **Every `required` entry must exist in `properties`.**

```json
{
  "type": "object",
  "properties": {
    "q": { "type": "string", "description": "Words to search for" },
    "category": { "type": "string", "description": "A category slug, e.g. electronics" },
    "sort": { "type": "string", "enum": ["relevance", "price", "newest"] }
  }
}
```

## The handler (`execute`)

- **Validate in code; reject only what's required.** The browser doesn't check arguments against the schema or fill defaults. Check required fields, and do what your site does when an optional field is left empty: an empty search lists everything, no category means all categories. Leave optional fields out of the request instead of rejecting the call.
- **Return errors as values; never throw them.** Return `{ error: "What went wrong", hint: "What to try instead" }` for bad input or a failed request. Throwing is only for cancellation.
- **Honour the `AbortSignal`.** Pass `signal` to every `fetch`, and stop when it's aborted.
- **Call your site the way your site does.** Same API route, method, body shape and headers as your own code, or the same server action with the same arguments.
- **Return something useful.** The parsed JSON, or a short summary of it; never `undefined`.

```ts
async execute(input, { signal }) {
  const url = new URL('/api/search', location.origin)
  if (typeof input.q === 'string' && input.q) url.searchParams.set('q', input.q)
  if (typeof input.category === 'string' && input.category) url.searchParams.set('category', input.category)
  const res = await fetch(url, { signal })
  if (!res.ok) return { error: `Search failed (${res.status})`, hint: 'Try fewer words.' }
  return await res.json()
}
```

## Test before you ship

Call every tool the way an agent would, before it goes live:

1. With **no arguments**, or only the required ones. It must not return an error about missing input.
2. With **every field** filled with a sensible value.
3. Check it **returns** a value (never `undefined`), **doesn't throw**, **finishes**, and **calls your API** (or server action).

Agent Nic runs exactly these calls on every handler it writes, in an isolated sandbox with a fake page and API, and fixes or drops any tool that fails before it opens the pull request.

## Content-Security-Policy

If your site sends a `Content-Security-Policy`, the SDK needs `https://cdn.jsdelivr.net` in `script-src` (the SDK file) and `https://api.agentronics.dev` in `connect-src` (rules, tool registry and events). Agent Nic adds both to the policies it finds in your repo (Next.js `headers()`, middleware, `vercel.json`, `netlify.toml`, `_headers`, `<meta http-equiv>`) and lists any it couldn't edit in the pull request.
