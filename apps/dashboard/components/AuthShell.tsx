import { preload } from "react-dom";
import { clerkBootRequests } from "@/lib/clerkAssets";
import { Logomark } from "./Logomark";
import { StaticCard, type AuthVariant } from "./AuthStaticCard";

/**
 * Sign-in / sign-up frame: ink with the logo, the Clerk card on top in white.
 * Log in and Sign up on agentronics.dev link straight here, so signing in never
 * hops between domains.
 *
 * Clerk draws its card only after its script and two API calls finish (about a
 * second on a good connection). Until then a static copy of the same card, same
 * text and same measurements, stands in its place, so the swap is invisible.
 * The copy is hidden by CSS in the same frame Clerk's card appears
 * (.ag-authshell:has(.cl-cardBox)): never both, never neither. (<ClerkLoading>
 * isn't used: in Brave it kept the copy after Clerk's card showed, and in
 * Chrome it removed it a frame before the card drew.)
 */
export function AuthShell({ variant, placeholder = true, children }: { variant: AuthVariant; placeholder?: boolean; children: React.ReactNode }) {
  // Fire Clerk's two start-up API calls from <head>, in parallel with its
  // script, instead of after the script has run. clerk-js sends them with
  // credentials, so the preloads do too and the browser reuses them.
  for (const href of clerkBootRequests) preload(href, { as: "fetch", crossOrigin: "use-credentials" });
  return (
    <div className="ag-pcb ag-authshell" style={{ minHeight: "100vh", display: "grid", placeItems: "center", alignContent: "center", gap: 26, background: "var(--canvas)", color: "var(--content)", padding: "48px 16px" }}>
      <a href="https://www.agentronics.dev" style={{ display: "flex", alignItems: "center", gap: 10 }} aria-label="agentronics.dev">
        <Logomark size={28} />
        <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em" }}>agentronics</span>
      </a>
      {placeholder && <StaticCard variant={variant} />}
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
