// Dependency-free stacked-area chart (flat, hairline, brand palette) — per the
// design brief, no chart library; SVG honoring the design tokens.

interface Series {
  key: string;
  label: string;
  color: string;
}

export function StackedArea<T>({
  data,
  series,
  height = 220
}: {
  data: readonly T[];
  series: Series[];
  height?: number;
}) {
  const W = 760;
  const H = height;
  const padB = 24;
  const padT = 12;
  if (data.length === 0) {
    return <Empty height={height} />;
  }

  const cell = (row: T, key: string) => Number((row as Record<string, unknown>)[key] || 0);
  const totals = data.map((d) => series.reduce((s, ser) => s + cell(d, ser.key), 0));
  const max = Math.max(1, ...totals);
  const x = (i: number) => (data.length === 1 ? W / 2 : (i / (data.length - 1)) * W);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);

  // build cumulative stacked bands bottom→top
  let cumulative = data.map(() => 0);
  const bands = series.map((ser) => {
    const lower = [...cumulative];
    cumulative = cumulative.map((c, i) => c + cell(data[i]!, ser.key));
    const top = cumulative.map((c, i) => `${x(i)},${y(c)}`).join(" ");
    const bottom = lower.map((c, i) => `${x(i)},${y(c)}`).reverse().join(" ");
    return { ser, points: `${top} ${bottom}` };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" role="img">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={0} x2={W} y1={padT + g * (H - padT - padB)} y2={padT + g * (H - padT - padB)} stroke="var(--border)" strokeWidth={1} />
      ))}
      <line x1={0} x2={W} y1={H - padB} y2={H - padB} stroke="var(--border-strong)" strokeWidth={1} />
      {bands.map((b) => (
        <polygon key={b.ser.key} points={b.points} fill={b.ser.color} fillOpacity={0.55} stroke={b.ser.color} strokeWidth={1} />
      ))}
    </svg>
  );
}

function Empty({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        display: "grid",
        placeItems: "center",
        color: "var(--content-muted)",
        fontSize: 13,
        border: "1px dashed var(--border-strong)",
        borderRadius: "var(--radius-lg)"
      }}
    >
      No data yet — run an import to populate this chart.
    </div>
  );
}
