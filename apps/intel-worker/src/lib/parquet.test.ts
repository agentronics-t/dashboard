import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rawPath } from "@agentronics/intel-schema";
import { readRawParquet, toRawRows, writeRawParquet } from "./parquet.ts";
import { LocalFsStorage } from "./storage.ts";

const TENANT = "00000000-0000-4000-8000-000000000001";
const JOB = "11111111-2222-4333-8444-555555555555";

test("parquet round-trip through LocalFsStorage at canonical raw path", async () => {
  const root = await mkdtemp(join(tmpdir(), "intel-parquet-"));
  try {
    const storage = new LocalFsStorage(root);
    const records = [
      { agent: "GPTBot", requests: 120, action: "blocked" },
      { agent: "ClaudeBot", requests: 45, action: "allowed", nested: { zone: "agentronics.tech" } }
    ];
    const rows = toRawRows({
      records,
      jobId: JOB,
      source: "cloudflare",
      ingestedAt: new Date("2026-06-12T02:00:00Z")
    });

    const key = rawPath({ source: "cloudflare", tenantId: TENANT, dt: "2026-06-12", jobId: JOB });
    await storage.put(key, await writeRawParquet(rows));

    assert.equal(await storage.exists(key), true);
    const readBack = await readRawParquet(await storage.get(key));

    assert.equal(readBack.length, 2);
    assert.equal(readBack[0]!.job_id, JOB);
    assert.equal(readBack[0]!.source, "cloudflare");
    assert.equal(readBack[0]!.schema_version, 1);
    assert.equal(readBack[0]!.ingested_at.toISOString(), "2026-06-12T02:00:00.000Z");
    assert.deepEqual(JSON.parse(readBack[1]!.payload), records[1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty write is rejected", async () => {
  await assert.rejects(() => writeRawParquet([]), /empty parquet/);
});

test("storage key traversal is rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "intel-storage-"));
  try {
    const storage = new LocalFsStorage(root);
    await assert.rejects(() => storage.get("../outside"), /escapes storage root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
