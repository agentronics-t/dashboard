# Agent Nick

Agent Nick makes a customer's website agent-ready. They connect GitHub and pick
their repo. Agent Nick reads the code, proposes WebMCP tools for its pages, and
after one review (tools, who may use them, plan + payment) opens a pull request
that adds the tools. The customer's CI checks it, they accept it in the console,
and the tools go live with their next deploy.

```
console (Vercel)  ──Clerk token──▶  agent-nick (Cloud Run)  ──▶  GitHub App (read tree/blobs, commit, PR)
     │ reads Neon                        │ LangGraph pipeline         Gemini 3.8 Flash on Vertex AI
     └── Dodo checkout / webhook         └── checkpoints in Neon (schema agent_nick_graph)
                                         ◀── GitHub webhooks (PR merged/closed, CI, pushes)
```

## Pipeline

| Step | Who | Notes |
|---|---|---|
| Read the code | code | One API call lists the tree. Only the files a step needs are fetched. No clone. |
| Framework, pages, actions | code | `package.json`, file conventions and the TypeScript parser. Each page becomes a few-hundred-token digest. |
| Propose tools | Gemini (low effort) | One structured-output call per batch of pages. Code then enforces the rules: real source only, declarative forms only where safe, no password or card forms, risk mapped to hints and default auth. |
| Your review | customer | Pauses the LangGraph run (`interrupt`). It resumes in any process when they approve. Needs an active plan (Lite allows at most 10 tools). |
| Write code | templates + Gemini (medium) | `toolname` attributes on existing `<form>`s, `data-agent-tool` anchors for UI-only actions, one `webmcp-tools` module, and a mount per framework. Gemini writes only the bodies of fetch / server-action tools, checked and repaired once. |
| Validate | code | Every changed file must parse, and the module must follow the WebMCP guide's hard rules. |
| Pull request | GitHub API | One commit on `agentronics/agent-nick-<run>`. The PR body lists every tool. |
| CI checks | customer CI | `check_suite` webhook. One automatic fix attempt if CI fails. |
| Live | customer | **Accept & merge** in the console, or merge on GitHub. |

**Supported frameworks today:** Next.js (App Router and Pages Router), React SPAs (Vite/CRA) and static HTML. Anything else stops after the framework step with a clear message.

**Knowledge:** `apps/agent-nick/src/knowledge/` holds Google's modern-web-guidance WebMCP guides (Apache-2.0, pinned commit). The `sdk/` folder is empty until the SDK rebuild ships. Drop the SDK docs there, then run `pnpm --filter agent-nick knowledge:sync`. Every prompt then includes them, and codegen should switch to registering tools through the SDK.

## One-time setup

1. **GCP billing.** Vertex AI needs billing enabled on the project, or Gemini calls fail with `BILLING_DISABLED`.
2. **Clerk.** Dashboard → SSO connections → enable **GitHub** so people can sign in with GitHub.
3. **GitHub App.** Create it at github.com/settings/apps/new, or under the Agentronics org.
   - **Homepage:** `https://agentronics.dev`
   - **Callback URL:** `https://app.agentronics.dev/agent-nick/github/callback`
   - **Request user authorization (OAuth) during installation:** ✅. This is required: it lets the service prove the installation belongs to the person linking it.
   - **Redirect on update:** ✅
   - **Webhook URL:** `<agent-nick URL>/github/webhook`
   - **Webhook secret:** a long random string, which goes in Secret Manager as `github-webhook-secret`.
   - **Repository permissions:**
     - Contents: Read & write
     - Pull requests: Read & write
     - Checks: Read-only
     - Metadata: Read-only
   - **Subscribe to events:**
     - Pull request
     - Check suite
     - Push
   - **Where can it be installed:** Any account.
   - Then generate a **private key** and a **client secret**, and save them as Secret Manager `github-app-private-key` and `github-app-client-secret`.
4. **Dodo Payments.**
   - **Products:** create three monthly subscription products: Lite $29, Starter $89, Team $199.
   - **Webhook:** add one pointing at `https://app.agentronics.dev/api/dodo/webhook` for the `subscription.*` events.
5. **Database.** Apply migration `0005_agent_nick` to production **before** the console with Agent Nick deploys:
   ```bash
   pnpm --filter @agentronics/intel-schema db:migrate
   ```
6. **Deploy the service:**
   ```bash
   ./infra/deploy-agent-nick.sh <project> <clerk-issuer> <clerk-jwks-url> <app-id> <app-slug> <client-id> https://app.agentronics.dev
   ```
7. **Console env (Vercel):**
   - `AGENT_NICK_URL`
   - `GITHUB_APP_SLUG`
   - `DODO_PAYMENTS_API_KEY`
   - `DODO_PAYMENTS_ENVIRONMENT`
   - `DODO_PAYMENTS_WEBHOOK_KEY`
   - `DODO_PRODUCT_LITE`, `DODO_PRODUCT_STARTER`, `DODO_PRODUCT_TEAM`

## Local testing

- **Unit tests:** `pnpm --filter agent-nick test`. They run against a fake Next.js repo: detection, extraction, proposal rules, codegen, validation and signatures.
- **Whole pipeline on a public repo, without the GitHub App and without pushing:**
  ```bash
  DATABASE_URL=<scratch db> GCP_PROJECT=… GITHUB_DEV_TOKEN=$(gh auth token) \
    node --experimental-strip-types apps/agent-nick/scripts/dry-run.ts owner/repo
  ```
  - `FAKE_LLM=1` swaps Gemini for a rule-based stand-in.
  - `STOP_AT_REVIEW=1` leaves the run waiting for review.
  - `DRY_RUN_TENANT=<uuid>` attaches it to the console's tenant.
- **Service with a console that has no Clerk:** run the service with `DEV_AUTH=true DRY_RUN=true REQUIRE_PLAN=false`. `DEV_AUTH` is refused when `NODE_ENV=production`.
