import { ClerkLoading } from "@clerk/nextjs";
import { Logomark } from "./Logomark";

/**
 * Sign-in / sign-up frame: ink with the logo, the Clerk card on top in white.
 * Log in and Sign up on agentronics.dev link straight here, so signing in never
 * hops between domains. While Clerk's script loads (a second or two on a fresh
 * browser), a placeholder of the same card holds its place.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ag-pcb" style={{ minHeight: "100vh", display: "grid", placeItems: "center", alignContent: "center", gap: 26, background: "var(--canvas)", color: "var(--content)", padding: "48px 16px" }}>
      <a href="https://www.agentronics.dev" style={{ display: "flex", alignItems: "center", gap: 10 }} aria-label="agentronics.dev">
        <Logomark size={28} />
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em" }}>agentronics</span>
      </a>
      <ClerkLoading>
        <CardPlaceholder />
      </ClerkLoading>
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

function CardPlaceholder() {
  const bar = (width: number | string, height: number, extra: React.CSSProperties = {}) => (
    <div className="ag-skel" style={{ width, height, ...extra }} />
  );
  return (
    <div className="ag-auth-placeholder" aria-busy="true" aria-label="Loading sign-in">
      {bar(190, 20, { margin: "0 auto 10px" })}
      {bar(240, 14, { margin: "0 auto 30px" })}
      <div style={{ display: "flex", gap: 10, marginBottom: 30 }}>
        {bar("50%", 40)}
        {bar("50%", 40)}
      </div>
      {bar(100, 12, { marginBottom: 10 })}
      {bar("100%", 42, { marginBottom: 26 })}
      {bar("100%", 44, { borderRadius: 12 })}
    </div>
  );
}
