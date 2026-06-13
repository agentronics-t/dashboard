// p10/p50/p90 forecast fan chart — shaded p10–p90 band + p50 line.

import type { ForecastPoint } from "@/lib/queries";

export function ForecastBand({ points, height = 220 }: { points: ForecastPoint[]; height?: number }) {
  const W = 760;
  const H = height;
  const padB = 24;
  const padT = 12;
  if (points.length === 0) {
    return (
      <div style={{ height, display: "grid", placeItems: "center", color: "var(--content-muted)", fontSize: 13, border: "1px dashed var(--border-strong)", borderRadius: "var(--radius-lg)" }}>
        No forecast yet — the ML job writes p10/p50/p90 after the first import.
      </div>
    );
  }

  const max = Math.max(1, ...points.map((p) => p.p90));
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);

  const top = points.map((p, i) => `${x(i)},${y(p.p90)}`).join(" ");
  const bottom = points.map((p, i) => `${x(i)},${y(p.p10)}`).reverse().join(" ");
  const mid = points.map((p, i) => `${x(i)},${y(p.p50)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={0} x2={W} y1={padT + g * (H - padT - padB)} y2={padT + g * (H - padT - padB)} stroke="var(--border)" strokeWidth={1} />
      ))}
      <line x1={0} x2={W} y1={H - padB} y2={H - padB} stroke="var(--border-strong)" strokeWidth={1} />
      <polygon points={`${top} ${bottom}`} fill="var(--brand)" fillOpacity={0.13} />
      <polyline points={mid} fill="none" stroke="var(--brand-solid)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.p50)} r={2.5} fill="var(--brand-solid)" />
      ))}
    </svg>
  );
}
