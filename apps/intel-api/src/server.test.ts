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

before(async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  const getKey = createLocalJWKSet({ keys: [jwk] });

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
    tasks,
    secrets,
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
    assert.equal(res.json().error, "internal_caller_imports_only");
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

  // tool registry + site memory snapshots upserted
  const tools = await db
    .select({ name: schema.sdkToolRegistry.toolName })
    .from(schema.sdkToolRegistry)
    .where(eq(schema.sdkToolRegistry.tenantId, tenant!.id));
  assert.ok(tools.some((t) => t.name === "cart.add"));
  const mem = await db
    .select({ score: schema.sdkSiteMemory.score })
    .from(schema.sdkSiteMemory)
    .where(eq(schema.sdkSiteMemory.tenantId, tenant!.id));
  assert.equal(mem[0]?.score, 82);
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

test("an ingest key cannot read tenant data (events-only)", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { authorization: `Bearer ${ingestKey}` }
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "ingest_key_events_only");
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
