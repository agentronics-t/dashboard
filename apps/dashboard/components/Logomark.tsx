// Agentronics logomark: the copper "A". Same geometry as the landing site's
// components/ui/Logo.tsx (MARK_PATH), traced from the brand master. The colour
// is baked: it's the logo, so it reads the same on Bone and PCB Black.

const COPPER = "#E8763A";
const MARK_PATH = "M458 0L835 660L317 660L368 570L664 570L458 209L119 800L0 800Z";

export function Logomark({ size = 26 }: { size?: number; onDark?: boolean }) {
  return (
    <svg width={(size * 835) / 800} height={size} viewBox="0 0 835 800" role="img" aria-label="Agentronics" style={{ flex: "none" }}>
      <path d={MARK_PATH} fill={COPPER} />
    </svg>
  );
}
