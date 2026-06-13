import { RunImportButton } from "@/components/RunImportButton";
import { Badge, Card, CardTitle, PageHeader } from "@/components/ui";
import { getConnectors, getJobs } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function ago(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default async function ActivityPage() {
  const tenantId = await getTenantId();
  const [jobs, connectors] = await Promise.all([getJobs(tenantId), getConnectors(tenantId)]);
  const primary = connectors[0];

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Pipeline jobs and connector status"
        action={<RunImportButton connectorId={primary?.id} disabled={!primary} />}
      />

      <Card style={{ marginBottom: 18 }}>
        <CardTitle>Connectors</CardTitle>
        {connectors.length === 0 && (
          <div style={{ color: "var(--content-muted)", fontSize: 14 }}>
            No connectors yet — add one in Settings to start importing.
          </div>
        )}
        {connectors.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 6px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{c.type}</span>
              <Badge kind={c.secret_ref ? "succeeded" : "warning"}>{c.secret_ref ? "credential set" : "no credential"}</Badge>
            </div>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--content-muted)" }}>{c.id.slice(0, 8)}</code>
          </div>
        ))}
      </Card>

      <Card>
        <CardTitle>Recent jobs</CardTitle>
        {jobs.length === 0 && <div style={{ color: "var(--content-muted)", fontSize: 14 }}>No jobs yet.</div>}
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
