// Integration tests: real dev Neon DB, mocked Clerk (local JWKS),
// mocked Cloud Tasks + Secret Manager.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@agentronics/intel-schema/db";
import { AuthError, clerkVerifier } from "./auth.ts";
import { buildServer } from "./server.ts";
import type { SecretStore, TaskQueue } from "./gcp.ts";

const ISSUER = "https://clerk.test.agentronics.dev";
const ORG = `org_test_${Date.now()}`;

class FakeTasks implements TaskQueue {
  enqueued: string[] = [];
  async enqueueImport(jobId: string) {
    this.enqueued.push(jobId);
  }
}

class FakeSecrets implements SecretStore {
  values = new Map<string, string>();
  async write(name: string, value: string) {
    this.values.set(name, value);
    return name;
  }
}

const db = createDb();
const tasks = new FakeTasks();
const secrets = new FakeSecrets();

let app: ReturnType<typeof buildServer>;
let token!: string;
let jwkSet!: ReturnType<typeof createLocalJWKSet>;

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  const getKey = createLocalJWKSet({ keys: [jwk] });
  jwkSet = getKey;

  token = await new SignJWT({ org_id: ORG })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(ISSUER)
    .setSubject("user_test_1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);

  app = buildServer({
    db,
    auth: clerkVerifier({ issuer: ISSUER, getKey }),
    // intelligence routes are retired + off by default; mount them here so the
    // legacy connector/import tests keep guarding that code path.
    intelligence: { tasks, secrets },
    internalAuth: {
      async verify(token: string) {
        if (token !== "internal-svc-token") {
          throw new AuthError("not the scheduler");
        }
        return { email: "intel-scheduler@test.iam.gserviceaccount.com" };
      }
    }
  });
  await app.ready();
});

after(async () => {
  await app.close();
  // cascade removes connectors + jobs created by these tests
  await db.delete(schema.tenants).where(eq(schema.tenants.clerkOrgId, ORG));
  process.exit(0);
});

const authed = () => ({ authorization: `Bearer ${token}` });

test("requests without a token are rejected", async () => {
  const res = await app.inject({ method: "GET", url: "/v1/jobs" });
  assert.equal(res.statusCode, 401);
});

test("requests with a bad token are rejected", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { authorization: "Bearer not-a-jwt" }
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "invalid_token");
});

test("connector create stores config in Neon and secret only as a ref", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/connectors",
    headers: authed(),
    payload: {
      type: "cloudflare",
      config: { zone_id: "z123" },
      secret: "cf-api-token-value"
    }
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.type, "cloudflare");
  assert.match(body.secret_ref, /^connector-.*-cloudflare$/);
  // secret value reached the store, not the DB response
  assert.equal(secrets.values.get(body.secret_ref), "cf-api-token-value");

  const list = await app.inject({ method: "GET", url: "/v1/connectors", headers: authed() });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().connectors.length, 1);
  assert.equal(JSON.stringify(list.json()).includes("cf-api-token-value"), false);
});

test("connector create is an idempotent upsert", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/connectors",
    headers: authed(),
    payload: { type: "cloudflare", config: { zone_id: "z456" } }
  });
  assert.equal(res.statusCode, 201);
  const list = await app.inject({ method: "GET", url: "/v1/connectors", headers: authed() });
  assert.equal(list.json().connectors.length, 1);
  assert.equal(list.json().connectors[0].config.zone_id, "z456");
});

test("import flow: 202 + queued job row + task enqueued with job_id only", async () => {
  const connectors = await app.inject({
    method: "GET",
    url: "/v1/connectors",
    headers: authed()
  });
  const connectorId = connectors.json().connectors[0].id;

  const res = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: authed(),
    payload: { connector_id: connectorId }
  });
  assert.equal(res.statusCode, 202);
  const { job_id } = res.json();
  assert.ok(job_id);
  assert.deepEqual(tasks.enqueued, [job_id]);

  const job = await app.inject({ method: "GET", url: `/v1/jobs/${job_id}`, headers: authed() });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().status, "queued");
  assert.equal(job.json().type, "import");

  const jobs = await app.inject({ method: "GET", url: "/v1/jobs", headers: authed() });
  assert.equal(jobs.json().jobs.some((j: { id: string }) => j.id === job_id), true);
});

test("import with unknown connector is 404 and enqueues nothing", async () => {
  const countBefore = tasks.enqueued.length;
  const res = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: authed(),
    payload: { connector_id: "00000000-0000-4000-8000-00000000dead" }
  });
  assert.equal(res.statusCode, 404);
  assert.equal(tasks.enqueued.length, countBefore);
});

test("explicit ?tenant= that is not yours is 403", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/jobs?tenant=00000000-0000-4000-8000-00000000beef",
    headers: authed()
  });
  assert.equal(res.statusCode, 403);
});

test("internal (Scheduler) token can trigger imports for any connector", async () => {
  const connectors = await app.inject({
    method: "GET",
    url: "/v1/connectors",
    headers: authed()
  });
  const connectorId = connectors.json().connectors[0].id;

  const res = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: { authorization: "Bearer internal-svc-token" },
    payload: { connector_id: connectorId }
  });
  assert.equal(res.statusCode, 202);
  assert.ok(res.json().job_id);
});

test("internal token cannot read jobs or connectors", async () => {
  for (const url of ["/v1/jobs", "/v1/connectors"]) {
    const res = await app.inject({
      method: "GET",
      url,
      headers: { authorization: "Bearer internal-svc-token" }
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, "internal_caller_restricted");
  }
});

test("invalid body is 400 with zod detail", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/imports",
    headers: authed(),
    payload: { connector_id: "not-a-uuid" }
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "validation_failed");
});

// ---- SDK event stream -----------------------------------------------------

let ingestKey!: string;

const sampleBatch = () => ({
  events: [
    {
      id: `evt_${randomUUID()}`,
      siteId: "shop-acme",
      sessionId: "sess_1",
      occurredAt: new Date().toISOString(),
      type: "agent.detected",
      outcome: "success",
      agent: { class: "crawler", trust: "detected", confidence: 0.9, vendor: "GPTBot" },
      metadata: { page: "/" }
    },
    {
      id: `evt_${randomUUID()}`,
      siteId: "shop-acme",
      sessionId: "sess_1",
      occurredAt: new Date().toISOString(),
      type: "tool.registered",
      outcome: "success",
      tool: "cart.add",
      metadata: { group: "cart", page: "browse", inputSchema: { type: "object" }, tokens: 42 }
    },
    {
      id: `evt_${randomUUID()}`,
      siteId: "shop-acme",
      sessionId: "sess_1",
      occurredAt: new Date().toISOString(),
      type: "memory.updated",
      outcome: "success",
      metadata: { snapshot: { siteMap: { pages: [] } }, score: 82 }
    }
  ]
});

test("minting an SDK ingest key returns the raw key exactly once", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/sdk/keys",
    headers: authed(),
    payload: { label: "test-key" }
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.match(body.key, /^agtx_ik_/);
  assert.equal(body.label, "test-key");
  ingestKey = body.key;

  const list = await app.inject({ method: "GET", url: "/v1/sdk/keys", headers: authed() });
  assert.equal(list.statusCode, 200);
  // listing never exposes the raw key, only the prefix
  assert.equal(JSON.stringify(list.json()).includes(ingestKey), false);
  assert.ok(list.json().keys.some((k: { prefix: string }) => body.prefix === k.prefix));
});

test("ingest with a valid key stores raw events + rollups (202)", async () => {
  const batch = sampleBatch();
  const res = await app.inject({
    method: "POST",
    url: "/v1/sdk/events",
    headers: { authorization: `Bearer ${ingestKey}` },
    payload: batch
  });
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().accepted, 3);
  assert.equal(res.json().deduped, 0);

  // raw rows landed under the key's tenant
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.clerkOrgId, ORG));
  const rawCount = await db
    .select({ id: schema.sdkEvents.id })
    .from(schema.sdkEvents)
    .where(eq(schema.sdkEvents.tenantId, tenant!.id));
  assert.ok(rawCount.length >= 3);
});

test("POST /v1/sdk/tools upserts the tool registry (schema + tokens)", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/sdk/tools",
    headers: { authorization: `Bearer ${ingestKey}` },
    payload: {
      siteId: "shop-acme",
      tools: [
        {
          name: "cart.add",
          group: "cart",
          page: "browse",
          inputSchema: { type: "object", properties: { itemId: { type: "string" } } },
          outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
          tokens: 42
        }
      ]
    }
  });
  assert.equal(res.statusCode, 202);
  assert.equal(res.json().tools, 1);

  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.clerkOrgId, ORG));
  const [tool] = await db
    .select({
      name: schema.sdkToolRegistry.toolName,
      page: schema.sdkToolRegistry.page,
      tokens: schema.sdkToolRegistry.tokens
    })
    .from(schema.sdkToolRegistry)
    .where(eq(schema.sdkToolRegistry.tenantId, tenant!.id));
  assert.equal(tool?.name, "cart.add");
  assert.equal(tool?.page, "browse");
  assert.equal(tool?.tokens, 42);
});

test("POST /v1/sdk/memory upserts the site-memory snapshot + score", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/sdk/memory",
    headers: { authorization: `Bearer ${ingestKey}` },
    payload: {
      siteId: "shop-acme",
      snapshot: { siteMap: { pages: [{ path: "/", name: "Home" }] } },
      score: 82
    }
  });
  assert.equal(res.statusCode, 202);

  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.clerkOrgId, ORG));
  const [mem] = await db
    .select({ score: schema.sdkSiteMemory.score, snapshot: schema.sdkSiteMemory.snapshot })
    .from(schema.sdkSiteMemory)
    .where(eq(schema.sdkSiteMemory.tenantId, tenant!.id));
  assert.equal(mem?.score, 82);
  assert.ok(mem?.snapshot);
});

test("ingest is idempotent on event id (re-POST dedupes)", async () => {
  const batch = sampleBatch();
  const first = await app.inject({
    method: "POST",
    url: "/v1/sdk/events",
    headers: { authorization: `Bearer ${ingestKey}` },
    payload: batch
  });
  assert.equal(first.json().accepted, 3);
  const again = await app.inject({
    method: "POST",
    url: "/v1/sdk/events",
    headers: { authorization: `Bearer ${ingestKey}` },
    payload: batch
  });
  assert.equal(again.statusCode, 202);
  assert.equal(again.json().accepted, 0);
  assert.equal(again.json().deduped, 3);
});

test("an ingest key cannot read tenant data (write-only)", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { authorization: `Bearer ${ingestKey}` }
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "ingest_key_write_only");
});

test("an unknown ingest key is rejected", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/sdk/events",
    headers: { authorization: "Bearer agtx_ik_totally-made-up" },
    payload: sampleBatch()
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "invalid_ingest_key");
});

test("a revoked key is rejected on ingest", async () => {
  const minted = await app.inject({
    method: "POST",
    url: "/v1/sdk/keys",
    headers: authed(),
    payload: { label: "to-revoke" }
  });
  const { id, key } = minted.json();
  const rev = await app.inject({
    method: "POST",
    url: `/v1/sdk/keys/${id}/revoke`,
    headers: authed()
  });
  assert.equal(rev.statusCode, 200);
  const res = await app.inject({
    method: "POST",
    url: "/v1/sdk/events",
    headers: { authorization: `Bearer ${key}` },
    payload: sampleBatch()
  });
  assert.equal(res.statusCode, 401);
});

// ---- agent-auth pivot: intelligence off by default + retention ------------

test("without intelligence deps, connector/import/job routes do not exist", async () => {
  const bare = buildServer({ db, auth: clerkVerifier({ issuer: ISSUER, getKey: jwkSet }) });
  await bare.ready();
  try {
    for (const [method, url] of [
      ["GET", "/v1/connectors"],
      ["POST", "/v1/imports"],
      ["GET", "/v1/jobs"]
    ] as const) {
      const res = await bare.inject({ method, url, headers: authed(), ...(method === "POST" ? { payload: {} } : {}) });
      assert.equal(res.statusCode, 404, `${method} ${url} should be unmounted`);
    }
  } finally {
    await bare.close();
  }
});

test("prune is internal-only: a Clerk session and an ingest key are both 403", async () => {
  for (const authorization of [`Bearer ${token}`, `Bearer ${ingestKey}`]) {
    const res = await app.inject({ method: "POST", url: "/v1/maintenance/prune", headers: { authorization } });
    assert.equal(res.statusCode, 403);
  }
});

test("prune (internal) deletes sdk_events past the retention window, keeps recent", async () => {
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(eq(schema.tenants.clerkOrgId, ORG));
  const base = {
    tenantId: tenant!.id,
    siteId: "prune-site",
    sessionId: "sess_prune",
    occurredAt: new Date(),
    type: "agent.detected" as const,
    outcome: "success" as const
  };
  const oldId = `evt_old_${randomUUID()}`;
  const newId = `evt_new_${randomUUID()}`;
  await db.insert(schema.sdkEvents).values([
    { ...base, id: oldId, ingestedAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) },
    { ...base, id: newId, ingestedAt: new Date() }
  ]);

  const res = await app.inject({
    method: "POST",
    url: "/v1/maintenance/prune",
    headers: { authorization: "Bearer internal-svc-token" }
  });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().pruned_events >= 1);

  const ids = (
    await db.select({ id: schema.sdkEvents.id }).from(schema.sdkEvents).where(eq(schema.sdkEvents.siteId, "prune-site"))
  ).map((r) => r.id);
  assert.ok(!ids.includes(oldId), "old event pruned");
  assert.ok(ids.includes(newId), "recent event kept");
});

// ---- plans: monthly recording quota + per-plan retention -------------------

async function tenantWithKey(clerkOrgId: string, plan?: string) {
  const { generateIngestKey, monthStart } = await import("@agentronics/intel-schema");
  const [t] = await db.insert(schema.tenants).values({ name: clerkOrgId, clerkOrgId }).returning({ id: schema.tenants.id });
  const key = generateIngestKey();
  await db.insert(schema.sdkIngestKeys).values({ tenantId: t!.id, hashedKey: key.hash, prefix: key.prefix, label: "plan-test" });
  if (plan) await db.insert(schema.workspacePlans).values({ tenantId: t!.id, plan, status: "active" });
  return { tenantId: t!.id, key: key.raw, month: monthStart().date };
}

test("free plan: events past the monthly quota are dropped, never rejected (202)", async () => {
  const org = `org_quota_${randomUUID()}`;
  const { tenantId, key, month } = await tenantWithKey(org);
  try {
    // 4,999 of the Free plan's 5,000 already recorded this month.
    await db.insert(schema.sdkEventDaily).values({ tenantId, date: month, type: "agent.detected", agentClass: "crawler", outcome: "success", count: 4_999 });
    const res = await app.inject({ method: "POST", url: "/v1/sdk/events", headers: { authorization: `Bearer ${key}` }, payload: sampleBatch() });
    assert.equal(res.statusCode, 202);
    assert.equal(res.json().accepted, 1);
    assert.equal(res.json().dropped, 2);
    assert.deepEqual(res.json().quota, { plan: "free", limit: 5_000, used: 4_999 });

    const again = await app.inject({ method: "POST", url: "/v1/sdk/events", headers: { authorization: `Bearer ${key}` }, payload: sampleBatch() });
    assert.equal(again.statusCode, 202);
    assert.equal(again.json().accepted, 0);
    assert.equal(again.json().dropped, 3);
  } finally {
    await db.delete(schema.tenants).where(eq(schema.tenants.clerkOrgId, org));
  }
});

test("prune keeps each workspace's plan retention (free 7d, starter 30d)", async () => {
  const freeOrg = `org_ret_free_${randomUUID()}`;
  const starterOrg = `org_ret_starter_${randomUUID()}`;
  const free = await tenantWithKey(freeOrg);
  const starter = await tenantWithKey(starterOrg, "starter");
  try {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const row = (tenantId: string) => ({
      id: `evt_ret_${randomUUID()}`,
      tenantId,
      siteId: "ret-site",
      sessionId: "sess_ret",
      occurredAt: tenDaysAgo,
      ingestedAt: tenDaysAgo,
      type: "agent.detected" as const,
      outcome: "success" as const
    });
    const [f, s] = [row(free.tenantId), row(starter.tenantId)];
    await db.insert(schema.sdkEvents).values([f, s]);

    const res = await app.inject({ method: "POST", url: "/v1/maintenance/prune", headers: { authorization: "Bearer internal-svc-token" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().retention_days.free, 7);

    const left = (await db.select({ id: schema.sdkEvents.id }).from(schema.sdkEvents).where(eq(schema.sdkEvents.siteId, "ret-site"))).map((r) => r.id);
    assert.ok(!left.includes(f.id), "10-day-old event pruned on Free");
    assert.ok(left.includes(s.id), "10-day-old event kept on Starter");
  } finally {
    await db.delete(schema.tenants).where(eq(schema.tenants.clerkOrgId, freeOrg));
    await db.delete(schema.tenants).where(eq(schema.tenants.clerkOrgId, starterOrg));
  }
});

// ---- pillars v2: tool status, console config, live agent keys -------------

const tenantRow = async () =>
  (await db.select({ id: schema.tenants.id }).from(schema.tenants).where(eq(schema.tenants.clerkOrgId, ORG)))[0]!;

test("tool.surfaced events set each tool's WebMCP status (callable / failed)", async () => {
  await app.inject({
    method: "POST",
    url: "/v1/sdk/tools",
    headers: { authorization: `Bearer ${ingestKey}` },
    payload: {
      siteId: "shop-acme",
      tools: [
        { name: "search", title: "Search", description: "Search the catalogue for products by keyword.", annotations: { readOnlyHint: true }, tokens: 30 },
        { name: "checkout", description: "Pay for the cart.", tokens: 20 }
      ]
    }
  });
  const at = new Date().toISOString();
  const res = await app.inject({
    method: "POST",
    url: "/v1/sdk/events",
    headers: { authorization: `Bearer ${ingestKey}` },
    payload: {
      events: [
        { id: `evt_${randomUUID()}`, siteId: "shop-acme", sessionId: "s", occurredAt: at, type: "tool.surfaced", tool: "search", outcome: "success", metadata: { state: "published" } },
        { id: `evt_${randomUUID()}`, siteId: "shop-acme", sessionId: "s", occurredAt: at, type: "tool.surfaced", tool: "checkout", outcome: "error", error: "TypeError: invalid inputSchema", metadata: { state: "failed" } }
      ]
    }
  });
  assert.equal(res.statusCode, 202);
  const rows = await db
    .select({ name: schema.sdkToolRegistry.toolName, status: schema.sdkToolRegistry.status, err: schema.sdkToolRegistry.statusError, title: schema.sdkToolRegistry.title, description: schema.sdkToolRegistry.description })
    .from(schema.sdkToolRegistry)
    .where(eq(schema.sdkToolRegistry.tenantId, (await tenantRow()).id));
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.search?.status, "callable");
  assert.equal(byName.search?.title, "Search");
  assert.equal(byName.search?.description, "Search the catalogue for products by keyword.");
  assert.equal(byName.checkout?.status, "failed");
  assert.equal(byName.checkout?.err, "TypeError: invalid inputSchema");
});

test("POST /v1/sdk/config returns site rules over '*' rules, most specific first, plus approved descriptions", async () => {
  const tenantId = (await tenantRow()).id;
  await db.insert(schema.sdkPolicies).values([
    { tenantId, siteId: "*", tool: "*", decision: "allow", minTrust: "detected" },
    { tenantId, siteId: "*", tool: "checkout", decision: "deny", minTrust: "detected" },
    { tenantId, siteId: "shop-acme", tool: "checkout", decision: "review", minTrust: "verified", allowedClasses: ["webmcp"], rateLimit: { max: 3, windowSeconds: 60 } },
    { tenantId, siteId: "other-site", tool: "search", decision: "deny", minTrust: "detected" }
  ]);
  await db.insert(schema.sdkToolDescriptions).values([
    { tenantId, siteId: "shop-acme", toolName: "search", original: "Search the catalogue for products by keyword.", suggested: "Search products by keyword.", originalTokens: 30, suggestedTokens: 22, status: "approved" },
    { tenantId, siteId: "shop-acme", toolName: "checkout", original: "Pay for the cart.", suggested: "Pay.", originalTokens: 20, suggestedTokens: 18, status: "suggested" }
  ]);
  const res = await app.inject({ method: "POST", url: "/v1/sdk/config", headers: { authorization: `Bearer ${ingestKey}` }, payload: { siteId: "shop-acme" } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(
    body.policies.map((p: { tool: string; decision: string }) => [p.tool, p.decision]),
    [["checkout", "review"], ["*", "allow"]]
  );
  assert.deepEqual(body.policies[0].allowedClasses, ["webmcp"]);
  assert.deepEqual(body.policies[0].rateLimit, { max: 3, windowSeconds: 60 });
  assert.deepEqual(body.toolDescriptions, { search: "Search products by keyword." });
});

test("POST /v1/sdk/agent-keys/verify checks console-minted keys live (revocation is immediate)", async () => {
  const tenantId = (await tenantRow()).id;
  const key = `agk_${randomUUID().replace(/-/g, "")}`;
  const { createHash } = await import("node:crypto");
  const [row] = await db
    .insert(schema.agentKeys)
    .values({ tenantId, agentId: "booking-agent", name: "Booking agent", vendor: "Acme", hashedKey: createHash("sha256").update(key).digest("hex"), prefix: key.slice(0, 10) })
    .returning({ id: schema.agentKeys.id });
  const verify = (k: string) => app.inject({ method: "POST", url: "/v1/sdk/agent-keys/verify", headers: { authorization: `Bearer ${ingestKey}` }, payload: { key: k } });

  const ok = await verify(key);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { valid: true, agentId: "booking-agent", name: "Booking agent", vendor: "Acme" });
  assert.deepEqual((await verify("agk_not-a-real-key")).json(), { valid: false });

  await db.update(schema.agentKeys).set({ revokedAt: new Date() }).where(eq(schema.agentKeys.id, row!.id));
  assert.deepEqual((await verify(key)).json(), { valid: false });
});
