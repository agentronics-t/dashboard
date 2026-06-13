import assert from "node:assert/strict";
import { test } from "node:test";
import { derivedPath, modelPath, rawJobPrefix, rawPath } from "./paths.ts";

const TENANT = "00000000-0000-4000-8000-000000000001";
const JOB = "11111111-2222-4333-8444-555555555555";

test("rawPath snapshot", () => {
  assert.equal(
    rawPath({ source: "cloudflare", tenantId: TENANT, dt: "2026-06-12", jobId: JOB }),
    `raw/cloudflare/${TENANT}/dt=2026-06-12/job=${JOB}/part-00000.parquet`
  );
  assert.equal(
    rawPath({ source: "scrunch", tenantId: TENANT, dt: "2026-06-12", jobId: JOB, part: 3 }),
    `raw/scrunch/${TENANT}/dt=2026-06-12/job=${JOB}/part-00003.parquet`
  );
});

test("derivedPath snapshot", () => {
  assert.equal(
    derivedPath({ tenantId: TENANT, dt: "2026-06-12" }),
    `derived/${TENANT}/agent_traffic_daily/dt=2026-06-12/part-00000.parquet`
  );
});

test("modelPath snapshot", () => {
  assert.equal(
    modelPath({ tenantId: TENANT, metric: "requests", modelVersion: "v1" }),
    `models/${TENANT}/requests/v1/model.pkl`
  );
  assert.equal(
    modelPath({ tenantId: TENANT, metric: "requests", modelVersion: "v1", file: "metadata.json" }),
    `models/${TENANT}/requests/v1/metadata.json`
  );
});

test("rawJobPrefix snapshot", () => {
  assert.equal(
    rawJobPrefix({ source: "profound", tenantId: TENANT, dt: "2026-06-12", jobId: JOB }),
    `raw/profound/${TENANT}/dt=2026-06-12/job=${JOB}/`
  );
});

test("invalid inputs rejected", () => {
  assert.throws(() =>
    rawPath({ source: "cloudflare", tenantId: TENANT, dt: "12-06-2026", jobId: JOB })
  );
  assert.throws(() =>
    rawPath({ source: "cloudflare", tenantId: TENANT, dt: "2026-06-12", jobId: JOB, part: -1 })
  );
  // @ts-expect-error — unknown source must throw at runtime too
  assert.throws(() => rawPath({ source: "posthog", tenantId: TENANT, dt: "2026-06-12", jobId: JOB }));
});
