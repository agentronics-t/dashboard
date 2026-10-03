import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle, Kpi, PageHeader, fmt } from "@/components/ui";
import { AuthLogTable, Mono, VerifiedBadge } from "@/components/console";
import { ago, getAgentDirectory, getAuthLogs, methodLabel } from "@/lib/console";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  let identity: string;
  try {
    identity = decodeURIComponent((await params).id);
  } catch {
    notFound(); // malformed escape sequence
  }
  const tenantId = await getTenantId();
  const [directory, logs] = await Promise.all([
    getAgentDirectory(tenantId, 30, 500),
    getAuthLogs(tenantId, { agent: identity, limit: 100 })
  ]);
  const agent = directory.find((a) => a.identity === identity);
  if (!agent) notFound();

  const methods = [...new Set(logs.map((l) => l.method).filter(Boolean))] as string[];
  const routeSnippet = `const agent = readAgentHeaders(await headers())
if (agent.id === ${JSON.stringify(identity)}) {
  // this agent, verified — tailor the response
}`;

  return (
    <>
      <div style={{ fontSize: 13, marginBottom: 8 }}>
        <Link href="/agents" style={{ color: "var(--content-muted)" }}>
          ← Agents
        </Link>
      </div>
      <PageHeader title={agent.name} subtitle={agent.verified ? "Verified agent" : "Unverified agent"} action={<VerifiedBadge verified={agent.verified} />} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 16 }}>
        <Kpi label="Sign-ins" value={fmt(agent.requests - agent.failures)} sub="30d" />
        <Kpi label="Failed" value={fmt(agent.failures)} sub="30d · still browsed as normal" />
        <Kpi label="Last seen" value={ago(agent.lastSeen)} sub={`first ${agent.firstSeen.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginBottom: 16 }}>
        <Card>
          <CardTitle>Identity</CardTitle>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 10, fontSize: 13 }}>
            <dt style={{ color: "var(--content-muted)" }}>Agent id</dt>
            <dd style={{ margin: 0 }}>
              <Mono>{agent.identity}</Mono>
            </dd>
            <dt style={{ color: "var(--content-muted)" }}>Methods</dt>
            <dd style={{ margin: 0 }}>{methods.length ? methods.map(methodLabel).join(", ") : "—"}</dd>
            <dt style={{ color: "var(--content-muted)" }}>Last failure</dt>
            <dd style={{ margin: 0 }}>
              <Mono muted>{agent.lastError ?? "—"}</Mono>
            </dd>
          </dl>
        </Card>
        <Card>
          <CardTitle>Use this identity in your app</CardTitle>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--content-secondary)", lineHeight: 1.55 }}>
            When this agent verifies, your routes receive its id in the <code>x-agentronics-*</code> headers. Agentronics never blocks — what you do with the identity is up to your app.
          </p>
          <pre style={{ margin: 0, padding: 12, borderRadius: "var(--radius-md)", background: "var(--surface-raised)", fontSize: 12, overflowX: "auto" }}>
            <code>{routeSnippet}</code>
          </pre>
          <p style={{ margin: "10px 0 0", fontSize: 12 }}>
            <a href="https://agentronics.dev/docs/frameworks/nextjs" style={{ color: "var(--brand)" }}>
              Reading the verified agent →
            </a>
          </p>
        </Card>
      </div>

      <Card>
        <CardTitle>Auth logs · {logs.length}</CardTitle>
        <AuthLogTable rows={logs} showAgent={false} />
      </Card>
    </>
  );
}
