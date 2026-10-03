import { ForecastBand } from "@/components/charts/ForecastBand";
import { Card, CardTitle, fmt, PageHeader, Legend } from "@/components/ui";
import { getForecasts } from "@/lib/queries";
import { getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const METRICS = ["requests", "blocked", "allowed"];

export default async function ForecastPage() {
  const tenantId = await getTenantId();
  const all = await getForecasts(tenantId);

  return (
    <>
      <PageHeader title="Forecast" subtitle="14-day projection with p10 / p50 / p90 uncertainty bands" />
      {METRICS.map((metric) => {
        const points = all.filter((f) => f.metric === metric);
        const version = points[0]?.model_version;
        const horizonTotal = points.reduce((s, p) => s + p.p50, 0);
        return (
          <Card key={metric} style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <CardTitle>{metric[0]!.toUpperCase() + metric.slice(1)}</CardTitle>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--content-muted)" }}>
                {version ? `${version} · ~${fmt(Math.round(horizonTotal))} expected` : "no model yet"}
              </span>
            </div>
            <ForecastBand points={points} />
            <Legend items={[
              { label: "p50 (expected)", color: "var(--brand-solid)" },
              { label: "p10–p90 band", color: "var(--brand)" }
            ]} />
          </Card>
        );
      })}
    </>
  );
}
