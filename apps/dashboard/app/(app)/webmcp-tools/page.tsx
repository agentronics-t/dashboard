import { Badge, Card, CardTitle, PageHeader, fmt } from "@/components/ui";
import { ContextBar, SdkEmpty } from "@/components/sdk";
import { getSdkToolRegistry } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function WebmcpToolsPage() {
  const tenantId = await getTenantId();
  const tools = await getSdkToolRegistry(tenantId);

  // group page-wise (page == stage); null page → "unstaged"
  const byPage = new Map<string, typeof tools>();
  for (const t of tools) {
    const key = t.page ?? "unstaged";
    byPage.set(key, [...(byPage.get(key) ?? []), t]);
  }

  return (
    <>
      <PageHeader title="WebMCP Tools" subtitle="Synced tool registry, page-wise, with token cost" />
      {tools.length === 0 ? (
        <SdkEmpty feature="tool" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {[...byPage.entries()].map(([page, pageTools]) => {
            const total = pageTools.reduce((s, t) => s + t.tokens, 0);
            return (
              <Card key={page}>
                <CardTitle>
                  Page: {page} · {pageTools.length} tool{pageTools.length === 1 ? "" : "s"}
                </CardTitle>
                <div style={{ marginBottom: 14 }}>
                  <ContextBar tokens={total} label={`Page “${page}” tools`} />
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {pageTools.map((t) => (
                    <details
                      key={t.toolName}
                      style={{ borderTop: "1px solid var(--border)", padding: "8px 4px" }}
                    >
                      <summary style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", listStyle: "none" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{t.toolName}</span>
                        {t.groupName && <Badge>{t.groupName}</Badge>}
                        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--content-muted)", fontFamily: "var(--font-mono)" }}>
                          ~{fmt(t.tokens)} tokens
                        </span>
                      </summary>
                      <div style={{ display: "grid", gridTemplateColumns: t.outputSchema ? "1fr 1fr" : "1fr", gap: 10, marginTop: 10 }}>
                        <Schema title="Input" value={t.inputSchema} />
                        {t.outputSchema ? <Schema title="Output" value={t.outputSchema} /> : null}
                      </div>
                    </details>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function Schema({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--content-muted)", fontWeight: 700, marginBottom: 4 }}>
        {title}
      </div>
      <pre style={{ margin: 0, background: "var(--code-bg)", color: "var(--code-fg)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "8px 10px", fontSize: 12, fontFamily: "var(--font-mono)", overflowX: "auto" }}>
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  );
}
