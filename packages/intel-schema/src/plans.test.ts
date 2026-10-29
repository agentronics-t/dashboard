import assert from "node:assert/strict";
import { test } from "node:test";
import { PLANS, PLAN_IDS, monthStart, resolvePlan, upgradeFor } from "./plans.ts";

test("only an active, in-period paid plan counts; everything else is Free", () => {
  const now = new Date("2026-10-23T00:00:00Z");
  assert.equal(resolvePlan(null, now), "free");
  assert.equal(resolvePlan({ plan: "pro", status: "active", currentPeriodEnd: null }, now), "pro");
  assert.equal(resolvePlan({ plan: "pro", status: "active", currentPeriodEnd: new Date("2026-11-01") }, now), "pro");
  assert.equal(resolvePlan({ plan: "pro", status: "active", currentPeriodEnd: new Date("2026-10-01") }, now), "free");
  assert.equal(resolvePlan({ plan: "starter", status: "on_hold", currentPeriodEnd: null }, now), "free");
  assert.equal(resolvePlan({ plan: "lite", status: "active", currentPeriodEnd: null }, now), "free");
});

test("plans get strictly more generous and upgrade hints pick the cheapest fit", () => {
  const order = PLAN_IDS.map((id) => PLANS[id]);
  for (let i = 1; i < order.length; i++) {
    const [a, b] = [order[i - 1]!.limits, order[i]!.limits];
    for (const k of ["agentNickRunsPerMonth", "requestsPerMonth"] as const) {
      assert.ok(b[k] === null || (a[k] !== null && b[k]! >= a[k]!), `${k} grows from ${order[i - 1]!.id} to ${order[i]!.id}`);
    }
  }
  assert.equal(PLANS.pro.limits.agentNickRunsPerMonth, 30);
  assert.equal(upgradeFor((p) => p.limits.agentNickStrategies.includes("server_action"))?.id, "pro");
  assert.equal(upgradeFor((p) => (p.limits.agentNickToolsPerSite ?? Infinity) >= 12)?.id, "starter");
});

test("monthStart is the first UTC day of the month", () => {
  assert.equal(monthStart(new Date("2026-10-23T18:00:00Z")).date, "2026-10-01");
});
