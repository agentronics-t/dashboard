// State-machine integration tests: real dev Neon DB, tmp-dir storage,
// fake secrets/ML/adapters. Asserts the full queued→running→succeeded|failed
// lifecycle including idempotency and Cloud Tasks retry semantics.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { rawPath } from "@agentronics/intel-schema";
import { createDb, schema } from "@agentronics/intel-schema/db";
import type { AdapterRegistry } from "./connectors/registry.ts";
import { readRawParquet } from "./lib/parquet.ts";
import { LocalFsStorage } from "./lib/storage.ts";
import type { SecretReader } from "./lib/secrets.ts";
import type { MlTrigger } from "./mlTrigger.ts";
import { buildServer } from "./server.ts";

const NOW = new Date("2026-06-12T03:00:00Z");
const DT = "2026-06-12";

class FakeSecrets implements SecretReader {
  values = new Map<string, string>([["connector-secret", "cf-token-value"]]);
  reads: string[] = [];
  async read(name: string) {
    this.reads.push(name);
    const v = this.values.get(name);
    if (!v) throw new Error(`no secret ${name}`);
    return v;
  }
}

class FakeMl implements MlTrigger {
  triggered: string[] = [];
  traceparents: (string | undefined)[] = [];
  failNext: Error | undefined;
  async trigger(jobId: string, traceparent?: string) {
    if (this.failNext) {
      const err = this.failNext;
      this.failNext = undefined;
      throw err;
    }
    this.triggered.push(jobId);
    this.traceparents.push(traceparent);
  }
}

const db = createDb();
const secrets = new FakeSecrets();
const ml = new FakeMl();
let pullBehavior: () => Promise<unknown[]> = async () => [{ agent: "GPTBot", n: 1 }];

const adapters = {
  cloudflare: { source: "cloudflare", pull: () => pullBehavior() },
  profound: { source: "profound", pull: () => pullBehavior() },
  scrunch: { source: "scrunch", pull: () => pullBehavior() }
} as AdapterRegistry;

let root: string;
let storage: LocalFsStorage;
let app: ReturnType<typeof buildServer>;
let tenantId: string;
let connectorId: string;

async function createJob(): Promise<string> {
  const [job] = await db
    .insert(schema.jobs)
    .values({ tenantId, connectorId, type: "import", status: "queued" })
    .returning({ id: schema.jobs.id });
  return job!.id;
}

async function getJob(id: string) {
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, id));
  return job!;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), "intel-worker-test-"));
  storage = new LocalFsStorage(root);
  app = buildServer({ db, storage, secrets, ml, adapters, now: () => NOW });
  await app.ready();

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: "worker-test", clerkOrgId: `org_worker_${Date.now()}` })
    .returning({ id: schema.tenants.id });
  tenantId = tenant!.id;
  const [connector] = await db
    .insert(schema.connectors)
    .values({
      tenantId,
      type: "cloudflare",
      config: { zone_tag: "z1" },
      secretRef: "connector-secret"
    })
    .returning({ id: schema.connectors.id });
  connectorId = connector!.id;
});

after(async () => {
  await app.close();
  await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
  await rm(root, { recursive: true, force: true });
  process.exit(0);
});

test("happy path: queued → running → succeeded with raw parquet + ml trigger", async () => {
  pullBehavior = async () => [
    { agent: "GPTBot", requests: 120 },
    { agent: "ClaudeBot", requests: 45 }
  ];
  const jobId = await createJob();

  const res = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, "succeeded");

  const job = await getJob(jobId);
  assert.equal(job.status, "succeeded");
  assert.equal(job.attempt, 1);
  assert.ok(job.startedAt && job.finishedAt);
  assert.equal(job.error, null);

  const key = rawPath({ source: "cloudflare", tenantId, dt: DT, jobId });
  assert.equal((job.gcsPaths as { raw: string[] }).raw[0], storage.uri(key));
  const rows = await readRawParquet(await storage.get(key));
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.job_id, jobId);
  assert.deepEqual(ml.triggered, [jobId]);
});

test("idempotency: re-delivered task for a succeeded job is a no-op", async () => {
  const jobId = ml.triggered[0]!;
  const res = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, "already_succeeded");
  assert.equal(ml.triggered.length, 1); // not re-triggered
  assert.equal((await getJob(jobId)).attempt, 1); // not re-run
});

test("transient failure: 500 so Cloud Tasks retries; error recorded, back to queued", async () => {
  pullBehavior = async () => {
    throw new Error("cloudflare 429 exhausted");
  };
  const jobId = await createJob();

  const res = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId },
    headers: { "x-cloudtasks-taskretrycount": "1" }
  });
  assert.equal(res.statusCode, 500);

  const job = await getJob(jobId);
  assert.equal(job.status, "queued");
  assert.match(job.error ?? "", /429/);
  assert.equal(job.attempt, 1);
});

test("retries exhausted: job marked failed, task acked with 200", async () => {
  pullBehavior = async () => {
    throw new Error("permanent credential failure");
  };
  const jobId = await createJob();

  const res = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId },
    headers: { "x-cloudtasks-taskretrycount": "4" }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, "failed_permanently");

  const job = await getJob(jobId);
  assert.equal(job.status, "failed");
  assert.match(job.error ?? "", /credential/);
  assert.ok(job.finishedAt);

  // and a re-delivered task for the failed job is a no-op
  const again = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId }
  });
  assert.equal(again.json().outcome, "already_failed");
});

test("ml NOT_FOUND (job not deployed yet) does not fail the import", async () => {
  pullBehavior = async () => [{ agent: "PerplexityBot", requests: 9 }];
  ml.failNext = Object.assign(new Error("job not found"), { code: 5 });
  const jobId = await createJob();

  const res = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().outcome, "succeeded");
  assert.equal((await getJob(jobId)).status, "succeeded");
});

test("unknown job id and malformed payload are acked (dropped), not retried", async () => {
  const unknown = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: "00000000-0000-4000-8000-00000000dead" }
  });
  assert.equal(unknown.statusCode, 200);
  assert.equal(unknown.json().outcome, "dropped_unknown_job");

  const malformed = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { nope: true }
  });
  assert.equal(malformed.statusCode, 200);
  assert.equal(malformed.json().outcome, "dropped_malformed");
});

test("permanent failure writes a pipeline_failure insight", async () => {
  pullBehavior = async () => {
    throw new Error("credentials revoked upstream");
  };
  const jobId = await createJob();
  await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId },
    headers: { "x-cloudtasks-taskretrycount": "4" }
  });

  const [insight] = await db
    .select()
    .from(schema.insights)
    .where(eq(schema.insights.jobId, jobId));
  assert.ok(insight);
  assert.equal(insight.kind, "pipeline_failure");
  assert.equal(insight.severity, "critical");
  assert.match(insight.bodyMd, /credentials revoked/);
});

test("watchdog fails stuck jobs and leaves fresh ones alone", async () => {
  const stuckId = await createJob();
  const freshId = await createJob();
  const threeHoursAgo = new Date(NOW.getTime() - 3 * 60 * 60 * 1000);
  await db
    .update(schema.jobs)
    .set({ status: "running", startedAt: threeHoursAgo })
    .where(eq(schema.jobs.id, stuckId));
  await db
    .update(schema.jobs)
    .set({ status: "running", startedAt: new Date(NOW.getTime() - 60_000) })
    .where(eq(schema.jobs.id, freshId));

  const res = await app.inject({ method: "POST", url: "/tasks/watchdog" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().failed >= 1, true);

  const stuck = await getJob(stuckId);
  assert.equal(stuck.status, "failed");
  assert.match(stuck.error ?? "", /watchdog/);
  assert.equal((await getJob(freshId)).status, "running");

  const [insight] = await db
    .select()
    .from(schema.insights)
    .where(eq(schema.insights.jobId, stuckId));
  assert.equal(insight?.kind, "pipeline_failure");
});

test("traceparent flows from task payload through to the ML trigger", async () => {
  pullBehavior = async () => [{ agent: "GPTBot", requests: 1 }];
  const jobId = await createJob();
  const tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

  const res = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId, traceparent: tp }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(ml.traceparents.at(-1), tp);
});

test("empty pull succeeds with no parquet written", async () => {
  pullBehavior = async () => [];
  const jobId = await createJob();

  const res = await app.inject({
    method: "POST",
    url: "/tasks/import",
    payload: { job_id: jobId }
  });
  assert.equal(res.statusCode, 200);
  const job = await getJob(jobId);
  assert.equal(job.status, "succeeded");
  assert.deepEqual(job.gcsPaths, { raw: [] });
});
