// Webhook export delivery against a scratch database:
// DATABASE_URL=postgres://… node --test … Skipped without one.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PlanId } from "@agentronics/intel-schema";
import { createDb, schema } from "@agentronics/intel-schema/db";
import { BATCH, deliverWebhooks } from "./webhooks.ts";

const url = process.env.DATABASE_URL;
const db = url ? createDb(url) : null!;
after(() => db?.$client.end());

const T0 = new Date("2026-10-25T10:00:00Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);

async function workspace(events: number) {
  const [t] = await db.insert(schema.tenants).values({ name: "hooks-test", clerkOrgId: `org_hooks_${randomUUID()}` }).returning({ id: schema.tenants.id });
  const tenantId = t!.id;
  await db.insert(schema.sdkWebhooks).values({ tenantId, url: "https://hooks.example.com/in", secret: "whsec_dGVzdA==", cursorAt: at(-1), nextAttemptAt: at(-1) });
  for (let i = 0; i < events; i += 100)
    await db.insert(schema.sdkEvents).values(
      Array.from({ length: Math.min(100, events - i) }, (_, j) => ({
        id: `ev_${tenantId.slice(0, 8)}_${String(i + j).padStart(4, "0")}`,
        tenantId,
        siteId: "shop",
        sessionId: "s1",
        occurredAt: at(0),
        type: "tool.executed" as const,
        tool: "search",
        agentClass: "assistant",
        outcome: "success" as const,
        ingestedAt: at(i + j)
      }))
    );
  const hook = async () => (await db.select().from(schema.sdkWebhooks).where(eq(schema.sdkWebhooks.tenantId, tenantId)))[0]!;
  return { tenantId, hook, cleanup: () => db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)) };
}

test("Pro: delivers new events in signed-ready batches and moves the cursor; retries the same batch after a failure", { skip: !url }, async () => {
  const w = await workspace(BATCH + 5);
  const plan = async (): Promise<PlanId> => "pro";
  const sent: { id: string; events: { id: string }[] }[] = [];
  let fail = true;
  const post = async (_u: string, _s: string, id: string, body: string) => {
    if (fail) return { ok: false, status: "503" };
    sent.push({ id, events: JSON.parse(body).data.events });
    return { ok: true, status: "200" };
  };
  try {
    const now = at(BATCH + 100); // every event has settled
    const first = await deliverWebhooks(db, plan, { now, post });
    assert.equal(first.failed_deliveries, 1);
    let h = await w.hook();
    assert.equal(h.failures, 1);
    assert.equal(h.lastStatus, "503");
    assert.ok(h.nextAttemptAt > now, "backs off");

    // Not due yet: nothing happens.
    fail = false;
    assert.equal((await deliverWebhooks(db, plan, { now, post })).endpoints, 0);

    const later = new Date(h.nextAttemptAt.getTime() + 1000);
    const r = await deliverWebhooks(db, plan, { now: later, post });
    assert.equal(r.delivered_events, BATCH + 5);
    assert.deepEqual(sent.map((b) => b.events.length), [BATCH, 5]);
    assert.equal(sent[0]!.events[0]!.id.endsWith("_0000"), true, "oldest first");
    h = await w.hook();
    assert.equal(h.failures, 0);
    assert.equal(h.cursorId, sent[1]!.events[4]!.id);

    // Nothing new: nothing sent.
    assert.equal((await deliverWebhooks(db, plan, { now: later, post })).delivered_events, 0);
  } finally {
    await w.cleanup();
  }
});

test("events still settling wait for the next tick; a plan without webhooks pauses and skips ahead", { skip: !url }, async () => {
  const w = await workspace(3); // ingested at T0+0s, +1s, +2s
  const sent: number[] = [];
  const post = async (_u: string, _s: string, _id: string, body: string) => {
    sent.push(JSON.parse(body).data.events.length);
    return { ok: true, status: "200" };
  };
  try {
    await deliverWebhooks(db, async () => "pro", { now: at(31), post }); // only T0+0s and +1s have settled
    assert.deepEqual(sent, [2]);
    await deliverWebhooks(db, async () => "starter", { now: at(40), post });
    assert.deepEqual(sent, [2], "Starter gets no deliveries");
    const h = await w.hook();
    assert.equal(h.lastStatus, "paused: plan");
    assert.equal(h.cursorAt.getTime(), at(10).getTime(), "cursor skipped ahead");
  } finally {
    await w.cleanup();
  }
});
