import Link from "next/link";
import { limitLabel, upgradeFor } from "@agentronics/intel-schema";
import { Badge, Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { BarList, EventFeed } from "@/components/sdk";
import { AgentKeys } from "@/components/pillars/AgentKeys";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getWorkspacePlan } from "@/lib/billing";
import { AUTH_METHODS, AUTH_METHODS_LATER, getAgentKeys, getAuthFailureReasons, getAuthMethodStats } from "@/lib/pillars";
import { getSdkRecentEvents } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";
import { mintAgentKey, revokeAgentKey } from "./actions";

export const dynamic = "force-dynamic";

const SETUP = `// middleware.ts — authenticate every agent request (never blocks)
import { agentronicsMiddleware } from "@agentronics/sdk/next";
import { toTraceEvent } from "@agentronics/sdk/server";
import { createDashboardExporter, createDashboardSync } from "@agentronics/sdk";

const opts = { url: process.env.AGENTRONICS_API_URL!, ingestKey: process.env.AGENTRONICS_INGEST_KEY! };
const sync = createDashboardSync({ ...opts, siteId: "shop" });
const exporter = createDashboardExporter(opts);

export default agentronicsMiddleware({
  // Web Bot Auth + verified crawlers are on by default
  apiKey: { verify: sync.keyVerifier() },      // keys minted on this page
  oauth2: { issuer: "https://auth.shop.example", audience: "https://shop.example" },
  onResult: ({ result, request }) => {         // show them here
    const event = toTraceEvent(result, { siteId: "shop", request });
    if (event) exporter.export([event]);
  },
});`;

export default async function AuthPage() {
  const tenantId = await getTenantId();
  const [stats, reasons, keys, events, { spec: plan }] = await Promise.all([
    getAuthMethodStats(tenantId, 30),
    getAuthFailureReasons(tenantId, 30),
    getAgentKeys(tenantId),
    getSdkRecentEvents(tenantId, { types: ["auth.identity_presented", "auth.identity_cleared"], limit: 60 }),
    getWorkspacePlan(tenantId)
  ]);

  const signedPlan = plan.features.webBotAuthAndOAuth;
  // Totals only cover the methods this plan shows.
  const visible = stats.filter((s) => signedPlan || !["web-bot-auth", "oauth2"].includes(s.method));
  const byMethod = new Map(stats.map((s) => [s.method, s]));
  const verified = visible.reduce((n, s) => n + s.verified, 0);
  const failed = visible.reduce((n, s) => n + s.failed, 0);
  const delegated = visible.reduce((n, s) => n + s.delegated, 0);
  const signedUpgrade = upgradeFor((p) => p.features.webBotAuthAndOAuth);

  const env = Object.fromEntries(
    keys.filter((k) => !k.revokedAt).map((k) => [k.hashedKey, { agentId: k.agentId, name: k.name, ...(k.vendor ? { vendor: k.vendor } : {}) }])
  );

  return (
    <>
      <PageHeader title="Auth" subtitle="Which agents proved who they are, and how" action={<LiveRefresh />} />

      <div className="ag-grid-kpi">
        <Kpi label="Verified" value={fmt(verified)} sub="agent identities, 30d" />
        <Kpi label="Acting for a user" value={fmt(delegated)} sub="delegated OAuth tokens" />
        <Kpi label="Failed proofs" value={fmt(failed)} sub="claimed, not verified" />
        <Kpi label="Agent keys" value={fmt(keys.filter((k) => !k.revokedAt).length)} sub={`of ${limitLabel(plan.limits.agentApiKeys)} on ${plan.name}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14, marginBottom: 18 }}>
        {AUTH_METHODS.map((m) => {
          const s = byMethod.get(m.id);
          const locked = m.plan === "starter" && !signedPlan;
          return (
            <Card key={m.id} style={{ padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontWeight: 700 }}>{m.label}</div>
                {locked ? <Badge kind="queued">{signedUpgrade?.name ?? "Paid"}</Badge> : <Badge kind="succeeded">On</Badge>}
              </div>
              <div className="ag-muted" style={{ fontSize: 12.5, margin: "6px 0 12px", lineHeight: 1.45 }}>{m.proves}</div>
              {locked ? (
                <div style={{ fontSize: 13 }}>
                  Your SDK still verifies these agents.{" "}
                  <Link className="ag-link" href="/account">
                    Upgrade to {signedUpgrade?.name}
                  </Link>{" "}
                  to see them here.
                </div>
              ) : (
                <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
                  <span>
                    <strong style={{ fontSize: 20 }}>{fmt(s?.verified ?? 0)}</strong> verified
                  </span>
                  <span className="ag-muted">
                    <strong style={{ fontSize: 20, color: "var(--content)" }}>{fmt(s?.failed ?? 0)}</strong> failed
                  </span>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Coming later</CardTitle>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {AUTH_METHODS_LATER.map((m) => (
            <div key={m.label} style={{ border: "1px dashed var(--border-strong)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontSize: 13 }}>
              <strong>{m.label}</strong> <span className="ag-muted">· {m.detail}</span>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ marginBottom: 18 }}>
        <AgentKeys
          keys={keys.map(({ hashedKey: _h, ...k }) => k)}
          agentKeysEnv={JSON.stringify(env)}
          limit={limitLabel(plan.limits.agentApiKeys)}
          mint={mintAgentKey}
          revoke={revokeAgentKey}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18, marginBottom: 18 }}>
        <Card>
          <CardTitle>Why proofs failed</CardTitle>
          {reasons.length ? (
            <BarList items={reasons.map((r) => ({ label: r.reason, value: r.count, color: "var(--warning)" }))} />
          ) : (
            <div className="ag-muted" style={{ fontSize: 13 }}>No failed verifications in the last 30 days.</div>
          )}
        </Card>
        <Card>
          <CardTitle>Set up on your server</CardTitle>
          <pre style={{ margin: 0, background: "var(--code-bg)", color: "var(--code-fg)", borderRadius: "var(--radius-md)", padding: 12, fontSize: 12, overflowX: "auto" }}>
            {SETUP}
          </pre>
        </Card>
      </div>

      <Card>
        <CardTitle>Recent identity events</CardTitle>
        {events.length ? <EventFeed events={events} /> : <div className="ag-muted" style={{ fontSize: 13 }}>No identity events yet.</div>}
      </Card>
    </>
  );
}
