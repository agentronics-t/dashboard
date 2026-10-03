import { PluginCard, type PluginMeta } from "@/components/PluginCard";
import { RunImportButton } from "@/components/RunImportButton";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { getConnectors, getJobs } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const PLUGINS: PluginMeta[] = [
  {
    type: "cloudflare",
    name: "Cloudflare",
    blurb: "Bot & AI traffic from the GraphQL Analytics API plus AI Crawl Control — requests, blocking, and enforcement.",
    configHint: '{"zone_tag":"<your-zone-id>"}',
    credentialHint: "API token (Analytics:Read)"
  },
  {
    type: "profound",
    name: "Profound",
    blurb: "Answer-engine visibility — per-request records of how AI assistants reference your site.",
    configHint: "{}",
    credentialHint: "API key"
  },
  {
    type: "scrunch",
    name: "Scrunch",
    blurb: "Answer-engine monitoring — queries and responses across platforms over a 90-day window.",
    configHint: "{}",
    credentialHint: "API key"
  }
];

function ago(d: string | null) {
  return d ? new Date(d).toLocaleString() : "—";
}

export default async function PluginsPage() {
  const tenantId = await getTenantId();
  const [connectors, jobs] = await Promise.all([getConnectors(tenantId), getJobs(tenantId)]);
  const byType = new Map(connectors.map((c) => [c.type, c]));
  const primary = connectors[0];

  return (
    <>
      <PageHeader
        title="Plugins"
        subtitle="Connect your data sources — each plugin imports agent traffic into the platform"
        action={<RunImportButton connectorId={primary?.id} disabled={!primary} />}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 22 }}>
        {PLUGINS.map((p) => {
          const conn = byType.get(p.type);
          return (
            <PluginCard
              key={p.type}
              plugin={p}
              connected={!!conn?.secret_ref}
              config={conn?.config as Record<string, unknown> | undefined}
            />
          );
        })}
      </div>

      <Card>
        <CardTitle>Recent runs</CardTitle>
        {jobs.length === 0 && <div style={{ color: "var(--content-muted)", fontSize: 14 }}>No runs yet — connect a plugin and run an import.</div>}
        {jobs.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--content-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                <th style={th}>Job</th><th style={th}>Type</th><th style={th}>Status</th><th style={th}>Started</th><th style={th}>Finished</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={td}><code style={{ fontFamily: "var(--font-mono)" }}>{j.id.slice(0, 8)}</code></td>
                  <td style={td}>{j.type}</td>
                  <td style={td}><Badge kind={j.status}>{j.status}</Badge>{j.error && <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 4, maxWidth: 360 }}>{j.error.slice(0, 120)}</div>}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--content-muted)" }}>{ago(j.started_at as unknown as string)}</td>
                  <td style={{ ...td, fontFamily: "var(--font-mono)", color: "var(--content-muted)" }}>{ago(j.finished_at as unknown as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

const th: React.CSSProperties = { padding: "6px 8px", fontWeight: 700 };
const td: React.CSSProperties = { padding: "10px 8px", verticalAlign: "top" };
