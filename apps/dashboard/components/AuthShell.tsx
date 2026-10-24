import { Logomark } from "./Logomark";

/** Sign-in / sign-up frame: PCB Black with the mark, the Clerk card on top in Bone. */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ag-pcb" style={{ minHeight: "100vh", display: "grid", placeItems: "center", alignContent: "center", gap: 28, background: "var(--canvas)", color: "var(--content)", padding: "48px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Logomark size={28} />
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em" }}>agentronics</span>
      </div>
      {children}
    </div>
  );
}
