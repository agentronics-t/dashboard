// Integration tests: real dev Neon DB, mocked Clerk (local JWKS),
// mocked Cloud Tasks + Secret Manager.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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
