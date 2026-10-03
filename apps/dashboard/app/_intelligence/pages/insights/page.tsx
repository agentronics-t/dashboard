import { Badge, Card, PageHeader } from "@/components/ui";
import { getInsights } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Minimal, safe markdown → very light formatting (bold + line breaks). Insight
// bodies are model-generated but bounded; we render text, not arbitrary HTML.
function renderBody(md: string) {
  return md.split("\n").map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
      seg.startsWith("**") && seg.endsWith("**") ? <strong key={j}>{seg.slice(2, -2)}</strong> : seg
    );
    return <p key={i} style={{ margin: "0 0 6px" }}>{parts}</p>;
  });
}

export default async function InsightsPage() {
  const tenantId = await getTenantId();
  const insights = await getInsights(tenantId);

  return (
    <>
      <PageHeader title="Insights" subtitle="Natural-language analysis generated each pipeline run" />
      {insights.length === 0 && (
        <Card>
          <div style={{ color: "var(--content-muted)", fontSize: 14 }}>
            No insights yet. They appear after the first ML run narrates your traffic.
          </div>
        </Card>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {insights.map((it) => (
          <Card key={it.id}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>{it.title}</h3>
              <Badge kind={it.severity}>{it.severity}</Badge>
            </div>
            <div style={{ fontSize: 14, color: "var(--content-secondary)", lineHeight: 1.55 }}>{renderBody(it.body_md)}</div>
            <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--content-muted)" }}>
              {it.kind} · {new Date(it.created_at as unknown as string).toLocaleString()}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
