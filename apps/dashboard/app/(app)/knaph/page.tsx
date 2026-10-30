import Link from "next/link";
import { upgradeFor } from "@agentronics/intel-schema";
import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { EventFeed, SdkEmpty, UpgradeCard } from "@/components/sdk";
import { DescriptionReview, GenerateButton, type DescriptionItem } from "@/components/pillars/DescriptionReview";
import { LiveRefresh } from "@/components/LiveRefresh";
import { getWorkspacePlan } from "@/lib/billing";
import { getToolDescriptions, getTools } from "@/lib/pillars";
import { getSdkRecentEvents, getSdkSiteMemory } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";
import { descriptorTokens } from "@/lib/toolTokens";

export const dynamic = "force-dynamic";

function band(score: number) {
  if (score >= 75) return { label: "Strong", color: "var(--success)" };
  if (score >= 50) return { label: "Adequate", color: "var(--warning)" };
  return { label: "Thin", color: "var(--danger)" };
}

export default async function ProceduralMemoryPage() {
  const tenantId = await getTenantId();
  const [tools, descriptions, memory, events, { spec: plan }] = await Promise.all([
    getTools(tenantId),
    getToolDescriptions(tenantId),
    getSdkSiteMemory(tenantId),
    getSdkRecentEvents(tenantId, { types: ["memory.accessed", "memory.updated"], limit: 40 }),
    getWorkspacePlan(tenantId)
  ]);

  const byKey = new Map(descriptions.map((d) => [`${d.siteId}|${d.toolName}`, d]));
  const items: DescriptionItem[] = tools
    .filter((t) => (t.description ?? "").trim())
    .map((t) => {
      const d = byKey.get(`${t.siteId}|${t.toolName}`);
      return {
        siteId: t.siteId,
        toolName: t.toolName,
        page: t.page,
        original: t.description!.trim(),
        // Recomputed so the "before" number always matches the current code.
        originalTokens: descriptorTokens({ name: t.toolName, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations }),
        suggestion: d
          ? { text: d.suggested, tokens: d.suggestedTokens, status: d.status as "suggested" | "approved" | "rejected", rationale: d.rationale, model: d.model }
          : null
      };
    });
  const sites = [...new Set(items.map((i) => i.siteId))].sort();
  const before = items.reduce((s, i) => s + i.originalTokens, 0);
  const now = items.reduce((s, i) => s + (i.suggestion?.status === "approved" ? i.suggestion.tokens : i.originalTokens), 0);
  const waiting = items.filter((i) => i.suggestion?.status === "suggested").length;
  const locked = plan.features.siteMemory ? null : `Procedural memory isn't included in the ${plan.name} plan.`;
  const next = upgradeFor((p) => p.features.siteMemory);

  return (
    <>
      <PageHeader
        title="Procedural memory"
        subtitle="What agents read about each tool — rewritten by AI to say more in fewer tokens"
        action={<LiveRefresh />}
      />

      {locked ? (
        <UpgradeCard feature="Procedural memory" plan={plan.name} next={next?.name ?? null}>
          Agents read a description of every tool on your site. Memory rewrites them to say more in fewer tokens, and keeps a
          snapshot of your site that agents can read before they act.
        </UpgradeCard>
      ) : items.length === 0 && memory.length === 0 ? (
        <SdkEmpty feature="tool" />
      ) : (
        <>
          <div className="ag-grid-kpi">
            <Kpi label="Tools" value={fmt(items.length)} sub="with a description" />
            <Kpi label="Tokens agents read" value={fmt(now)} sub={before > now ? `was ${fmt(before)}` : "per page load, all tools"} />
            <Kpi label="Saved" value={before ? `${Math.round(((before - now) / before) * 100)}%` : "0%"} sub="from approved rewrites" />
            <Kpi label="Waiting for you" value={fmt(waiting)} sub="suggestions to review" />
          </div>

          {locked ? (
            <Card style={{ marginBottom: 18 }}>
              {locked}{" "}
              {next && (
                <Link className="ag-link" href="/account">
                  Upgrade to {next.name}
                </Link>
              )}
            </Card>
          ) : (
            sites.map((siteId) => (
              <Card key={siteId} style={{ marginBottom: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                  <CardTitle>Tool descriptions · {siteId}</CardTitle>
                  <GenerateButton siteId={siteId} label={items.some((i) => i.siteId === siteId && i.suggestion) ? "Rewrite again" : "Write descriptions"} />
                </div>
                <p className="ag-muted" style={{ margin: "-6px 0 8px", fontSize: 13 }}>
                  Approved rewrites reach agents through <code>pullConfig()</code> → <code>init(&#123; toolDescriptions &#125;)</code>. Your code doesn&apos;t change.
                </p>
                <DescriptionReview items={items.filter((i) => i.siteId === siteId)} />
              </Card>
            ))
          )}

          {memory.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginBottom: 18 }}>
              {memory.map((m) => {
                const b = m.score != null ? band(m.score) : null;
                return (
                  <Card key={m.siteId}>
                    <CardTitle>Site memory · {m.siteId}</CardTitle>
                    {b && (
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 30, fontWeight: 800, color: b.color, lineHeight: 1 }}>{m.score}</span>
                        <span style={{ color: "var(--content-muted)", fontSize: 13 }}>/ 100</span>
                        <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: b.color }}>{b.label}</span>
                      </div>
                    )}
                    <pre style={{ margin: 0, maxHeight: 220, overflow: "auto", background: "var(--code-bg)", color: "var(--code-fg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", fontSize: 12, fontFamily: "var(--font-mono)" }}>
                      {JSON.stringify(m.snapshot ?? {}, null, 2)}
                    </pre>
                  </Card>
                );
              })}
            </div>
          )}

          {events.length > 0 && (
            <Card>
              <CardTitle>Memory activity</CardTitle>
              <EventFeed events={events} />
            </Card>
          )}
        </>
      )}
    </>
  );
}
