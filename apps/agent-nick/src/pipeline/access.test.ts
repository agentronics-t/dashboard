// Per-tool access rules on merge (applyToolAccess). Needs a scratch database:
// DATABASE_URL=postgres://… pnpm test. Skipped without one.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@agentronics/intel-schema/db";
import { applyToolAccess } from "./followup.ts";

const url = process.env.DATABASE_URL;
const db = url ? createDb(url) : null!;
after(() => db?.$client.end());

async function fixture(plan: string | null, existingRules = 0) {
  const [t] = await db.insert(schema.tenants).values({ name: "access-test", clerkOrgId: `org_access_${randomUUID()}` }).returning({ id: schema.tenants.id });
  const tenantId = t!.id;
  if (plan) await db.insert(schema.workspacePlans).values({ tenantId, plan, status: "active" });
  const [site] = await db
    .insert(schema.agentNickSites)
    .values({ tenantId, installationId: 1, repoId: Math.floor(Math.random() * 1e9), repoFullName: "acme/shop", defaultBranch: "main" })
    .returning({ id: schema.agentNickSites.id });
  const [run] = await db.insert(schema.agentNickRuns).values({ tenantId, siteId: site!.id }).returning({ id: schema.agentNickRuns.id });
  const tool = (name: string, extra: Partial<typeof schema.agentNickTools.$inferInsert>) => ({
    runId: run!.id, siteId: site!.id, page: "/", name, kind: "script", description: name, inputSchema: {}, risk: "read", source: {}, ...extra
  });
  await db.insert(schema.agentNickTools).values([
    tool("search_products", { auth: "public" }),
    tool("view_orders", { auth: "signed_in" }),
    tool("checkout", { auth: "signed_in", risk: "payment", consequential: true }),
    tool("draft_tool", { approved: false })
  ]);
  for (let i = 0; i < existingRules; i++)
    await db.insert(schema.sdkPolicies).values({ tenantId, siteId: "*", tool: `mine_${i}`, decision: "deny", minTrust: "detected" });
  const rules = async () =>
    Object.fromEntries(
      (await db.select().from(schema.sdkPolicies).where(eq(schema.sdkPolicies.tenantId, tenantId)))
        .filter((r) => !r.tool.startsWith("mine_"))
        .map((r) => [r.tool, `${r.decision}/${r.minTrust}`])
    );
  return { db, tenantId, runId: run!.id, siteId: site!.id, rules, cleanup: () => db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)) };
}

test("Starter+: approved tools become access rules; payments ask first; drafts and Free get none", { skip: !url }, async () => {
  const pro = await fixture("pro");
  const free = await fixture(null);
  try {
    const msg = await applyToolAccess(pro.db, pro.runId, pro.siteId);
    assert.match(msg, /Added 3 access rules/);
    assert.deepEqual(await pro.rules(), {
      search_products: "allow/detected",
      view_orders: "allow/linked",
      checkout: "review/linked"
    });
    assert.equal(await applyToolAccess(free.db, free.runId, free.siteId), "");
    assert.deepEqual(await free.rules(), {});
  } finally {
    await pro.cleanup();
    await free.cleanup();
  }
});

test("Starter: rules stop at the plan's 5, and a customer's own rule is never overwritten", { skip: !url }, async () => {
  const st = await fixture("starter", 3);
  try {
    await st.db.insert(schema.sdkPolicies).values({ tenantId: st.tenantId, siteId: "*", tool: "search_products", decision: "deny", minTrust: "detected" });
    // 4 rules exist (3 + search_products): room for 1 more of the 2 new tools.
    const msg = await applyToolAccess(st.db, st.runId, st.siteId);
    assert.match(msg, /Added 1 access rule to Authz\. 1 tool has no rule/);
    const rules = await st.rules();
    assert.equal(rules.search_products, "deny/detected", "the customer's rule stays");
    assert.equal(Object.keys(rules).length, 2);
  } finally {
    await st.cleanup();
  }
});
