// Agentronics brand logomark — faithful vector ported from the landing page
// (landing_page/components/ui/Logo.tsx). Indigo module body with two amber
// blocks, three input arrows + one output arrow. Brand colors are baked;
// only the connector lines follow the surface theme.

const INDIGO = "#736ced";
const AMBER = "#ff9e1c";

export function Logomark({ size = 26, onDark = false }: { size?: number; onDark?: boolean }) {
  const lineColor = onDark ? "#f4f5f8" : "var(--content)";
  return (
    <svg
      width={size * (134 / 118)}
      height={size}
      viewBox="14 16 134 118"
      fill="none"
      role="img"
      aria-label="Agentronics"
      style={{ flex: "none" }}
    >
      <g stroke={lineColor} strokeWidth="2.4">
        <line x1="26.4" y1="34.4" x2="41.6" y2="34.4" />
        <line x1="26.4" y1="54.4" x2="41.6" y2="54.4" />
        <line x1="26.4" y1="74.4" x2="41.6" y2="74.4" />
        <line x1="112.8" y1="54.4" x2="136" y2="54.4" />
      </g>
      <g fill={INDIGO}>
        <polygon points="20,30.4 20,38.4 26.4,34.4" />
        <polygon points="20,50.4 20,58.4 26.4,54.4" />
        <polygon points="20,70.4 20,78.4 26.4,74.4" />
        <polygon points="136,50.4 136,58.4 143.2,54.4" />
      </g>
      <rect x="41.6" y="21.2" width="71.2" height="108.4" rx="6.4" fill={INDIGO} />
      <rect x="57.6" y="34" width="38" height="41.6" rx="2" fill={AMBER} />
      <rect x="57.6" y="86.8" width="38" height="42.8" rx="2" fill={AMBER} />
    </svg>
  );
}
