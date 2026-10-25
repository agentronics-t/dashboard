// Agentronics logo: the red "A" on a lime rounded square. Same geometry as the
// landing site's components/ui/Logo.tsx (MARK_PATH), traced from the brand
// master. The colours are baked: it's the logo, so it reads the same in both themes.

const MARK_PATH = "M458 0L835 660L317 660L368 570L664 570L458 209L119 800L0 800Z";

export function Logomark({ size = 26 }: { size?: number; onDark?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Agentronics" style={{ flex: "none" }}>
      <rect width="32" height="32" rx="9" fill="#D4FF3A" />
      <path transform="translate(8 8.33) scale(.019162)" d={MARK_PATH} fill="#FF4D1F" />
    </svg>
  );
}
