import { Logomark } from "./Logomark";

/**
 * Sign-in / sign-up frame: ink with the logo, the Clerk card on top in white.
 * Log in and Sign up on agentronics.dev link straight here, so signing in never
 * hops between domains.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ag-pcb" style={{ minHeight: "100vh", display: "grid", placeItems: "center", alignContent: "center", gap: 26, background: "var(--canvas)", color: "var(--content)", padding: "48px 16px" }}>
      <a href="https://www.agentronics.dev" style={{ display: "flex", alignItems: "center", gap: 10 }} aria-label="agentronics.dev">
        <Logomark size={28} />
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em" }}>agentronics</span>
      </a>
      {children}
      <p style={{ margin: 0, fontSize: 14, color: "var(--content-muted)" }}>
        Want a walkthrough first?{" "}
        <a className="ag-link" href="https://www.agentronics.dev/book">
          Book a demo
        </a>
      </p>
    </div>
  );
}
