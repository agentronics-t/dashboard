// Agentronics brand logomark — the "A" mark (indigo apex hood + left leg with a
// detached amber lower-right leg). Ported from the landing page
// (landing_page/components/ui/Logo.tsx). Brand colors are baked so it reads on
// light and dark alike; `onDark` is accepted for API compatibility.

const INDIGO = "#5b4fd1";
const AMBER = "#e58313";

export function Logomark({ size = 26, onDark: _onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg
      width={size * (142 / 114)}
      height={size}
      viewBox="20 30 142 114"
      fill="none"
      role="img"
      aria-label="Agentronics"
      style={{ flex: "none" }}
    >
      <polygon
        points="85,38 108,38 125,72 94,80 63,132 29,132"
        fill={INDIGO}
        stroke={INDIGO}
        strokeWidth="9"
        strokeLinejoin="round"
      />
      <polygon
        points="108,98 138,98 154,132 123,132"
        fill={AMBER}
        stroke={AMBER}
        strokeWidth="9"
        strokeLinejoin="round"
      />
    </svg>
  );
}
