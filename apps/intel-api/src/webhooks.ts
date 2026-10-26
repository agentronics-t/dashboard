// Webhook export delivery (Pro+). Cloud Scheduler calls
// POST /v1/maintenance/webhooks every minute; each due endpoint gets its new
// SDK events in batches, oldest first, from its (ingested_at, id) cursor.
// A failed delivery retries with backoff from the same cursor; after
// MAX_FAILURES in a row (about two days) the endpoint is switched off and the
// console says so.
import { createHash } from "node:crypto";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { PLANS, type PlanId } from "@agentronics/intel-schema";
import { schema, type Db } from "@agentronics/intel-schema/db";
import { postWebhook, type DeliveryResult } from "@agentronics/intel-schema/webhooks";

export const BATCH = 200;
const BATCHES_PER_TICK = 5;
const MAX_FAILURES = 20;
// Rows commit slightly out of ingested_at order; leave recent ones for the
// next tick so the cursor never skips one.
const SETTLE_MS = 30_000;

type Post = (url: string, secret: string, id: string, body: string) => Promise<DeliveryResult>;

export function backoffMs(failures: number): number {
  return Math.min(2 ** failures, 180) * 60_000; // 2, 4, 8 … minutes, capped at 3 hours
}

type EventRow = typeof schema.sdkEvents.$inferSelect;

export function webhookEvent(e: EventRow) {
  return {
    id: e.id,
    site_id: e.siteId,
    session_id: e.sessionId,
    occurred_at: e.occurredAt.toISOString(),
    type: e.type,
    tool: e.tool,
    agent: e.agentClass ? { class: e.agentClass, vendor: e.agentVendor, trust: e.trust } : null,
    outcome: e.outcome,
    duration_ms: e.durationMs,
    page: e.page,
    protocol: e.protocol,
    error: e.error,
    metadata: e.metadata
  };
}

export async function deliverWebhooks(
  db: Db,
  tenantPlan: (tenantId: string) => Promise<PlanId>,
  opts: { now?: Date; post?: Post } = {}
) {
  const now = opts.now ?? new Date();
  const post = opts.post ?? postWebhook;
  const settled = new Date(now.getTime() - SETTLE_MS);
  const due = await db
    .select()
    .from(schema.sdkWebhooks)
    .where(and(eq(schema.sdkWebhooks.enabled, true), lte(schema.sdkWebhooks.nextAttemptAt, now)))
    .limit(100);

  let delivered = 0;
  let failed = 0;
  for (const hook of due) {
    const set = (v: Partial<typeof schema.sdkWebhooks.$inferInsert>) =>
      db.update(schema.sdkWebhooks).set(v).where(eq(schema.sdkWebhooks.tenantId, hook.tenantId));

    // Not on a plan with webhooks (downgraded): skip ahead instead of
    // building a backlog to flood them with if they upgrade again.
    if (!PLANS[await tenantPlan(hook.tenantId)].features.webhookExport) {
      await set({ cursorAt: settled, cursorId: "", lastStatus: "paused: plan", nextAttemptAt: new Date(now.getTime() + 3_600_000) });
      continue;
    }

    let cursor = { at: hook.cursorAt, id: hook.cursorId };
    for (let i = 0; i < BATCHES_PER_TICK; i++) {
      const events = await db
        .select()
        .from(schema.sdkEvents)
        .where(
          and(
            eq(schema.sdkEvents.tenantId, hook.tenantId),
            sql`(${schema.sdkEvents.ingestedAt}, ${schema.sdkEvents.id}) > (${cursor.at.toISOString()}::timestamptz, ${cursor.id})`,
            lte(schema.sdkEvents.ingestedAt, settled)
          )
        )
        .orderBy(asc(schema.sdkEvents.ingestedAt), asc(schema.sdkEvents.id))
        .limit(BATCH);
      if (!events.length) break;

      const last = events[events.length - 1]!;
      // Same batch on retry → same id, so receivers can dedupe.
      const id = "msg_" + createHash("sha256").update(`${hook.tenantId}:${events[0]!.id}:${last.id}`).digest("hex").slice(0, 24);
      const body = JSON.stringify({ type: "events.batch", timestamp: now.toISOString(), data: { events: events.map(webhookEvent) } });
      const r = await post(hook.url, hook.secret, id, body);

      if (!r.ok) {
        failed++;
        const failures = hook.failures + 1;
        await set({
          failures,
          lastStatus: r.status,
          nextAttemptAt: new Date(now.getTime() + backoffMs(failures)),
          ...(failures >= MAX_FAILURES ? { enabled: false } : {})
        });
        break;
      }
      delivered += events.length;
      cursor = { at: last.ingestedAt, id: last.id };
      hook.failures = 0;
      await set({ cursorAt: cursor.at, cursorId: cursor.id, failures: 0, lastStatus: r.status, lastDeliveryAt: now, nextAttemptAt: now });
      if (events.length < BATCH) break;
    }
  }
  return { endpoints: due.length, delivered_events: delivered, failed_deliveries: failed };
}
