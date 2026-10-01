import { Card, CardTitle, PageHeader } from "@/components/ui";
import { ReasonLookup } from "@/components/help/ReasonLookup";
import { currentPlan } from "@/lib/billing/service";
import { db, getTenantId } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const DOCS = "https://agentronics.dev/docs";

const GUIDES = [
  { title: "Quickstart", body: "Verify your first agent in five minutes.", href: `${DOCS}/getting-started` },
  { title: "Authentication methods", body: "Web Bot Auth, API keys, OAuth2, crawlers, SSO, SPIFFE, mTLS.", href: `${DOCS}/auth/overview` },
  { title: "How it works", body: "Authenticate, pass through, record — Agentronics never blocks.", href: `${DOCS}/concepts/how-it-works` },
  { title: "Stream auth logs", body: "Send sign-ins from your middleware to this console.", href: `${DOCS}/guides/connect-to-dashboard` },
  { title: "Next.js", body: "Middleware, Clerk composition, route handlers.", href: `${DOCS}/frameworks/nextjs` },
  { title: "Server API", body: "Every option, result field and header.", href: `${DOCS}/reference/server-api` }
];

const FAQ = [
  {
    q: "Agent sign-ins aren't showing up here.",
    a: "Check the middleware's onResult exports events with an active ingest key (Configure → API keys), and that AGENTRONICS_INGEST_URL matches Settings → Endpoints. A 401 from the ingest endpoint means the key is wrong or revoked."
  },
  {
    q: "A real crawler shows as unverified.",
    a: "Look at the reason in Auth logs. crawler:client_ip_unknown or crawler:dns_unavailable_in_runtime are setup issues (client-IP header, Node.js runtime). crawler:no_rdns_method_for_vendor is expected for GPTBot, ClaudeBot and PerplexityBot."
  },
  {
    q: "Does Agentronics block agents or affect my human visitors?",
    a: "No. Agentronics only authenticates — it never blocks. Every request reaches your app: verified agents with their identity attached, unverified agents and humans exactly as before. Even if authentication fails internally, the request goes through."
  },
  {
    q: "What counts toward my monthly active agents?",
    a: "Each unique verified agent identity that signs in during the month, once — however many requests it makes. Human visitors and unverified agents never count."
  },
  {
    q: "How do I revoke an agent's key?",
    a: "Revoke it under Configure → API keys, copy the updated AGENT_KEYS value, and redeploy. The key stops working on that deploy."
  }
];

const SUPPORT: Record<string, string> = {
  free: "Community support — GitHub discussions and docs.",
  pro: "Email support — we reply within one business day.",
  business: "Priority support — we reply within four business hours.",
  enterprise: "Dedicated support — your shared Slack channel and named contact."
};

export default async function HelpPage() {
  const tenantId = await getTenantId();
  const plan = await currentPlan(db(), tenantId);
  return (
    <>
      <PageHeader title="Help" subtitle="Guides, troubleshooting and support" />
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
          {GUIDES.map((g) => (
            <a key={g.title} href={g.href} className="ag-row" style={{ display: "block", padding: 16, borderRadius: "var(--radius-lg, 12px)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--content)", textDecoration: "none" }}>
              <div style={{ fontWeight: 650 }}>{g.title} →</div>
              <div style={{ fontSize: 13, color: "var(--content-secondary)", marginTop: 4 }}>{g.body}</div>
            </a>
          ))}
        </div>

        <Card>
          <div id="errors" />
          <CardTitle>Why did a sign-in fail?</CardTitle>
          <ReasonLookup />
        </Card>

        <Card>
          <CardTitle>Common questions</CardTitle>
          <div style={{ display: "grid", gap: 4 }}>
            {FAQ.map((f) => (
              <details key={f.q} style={{ borderBottom: "1px solid var(--border)", padding: "10px 2px" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>{f.q}</summary>
                <p style={{ margin: "8px 0 2px", fontSize: 13.5, color: "var(--content-secondary)", lineHeight: 1.6 }}>{f.a}</p>
              </details>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>Contact us</CardTitle>
          <p style={{ margin: "0 0 12px", fontSize: 14, color: "var(--content-secondary)" }}>{SUPPORT[plan.tier]}</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href="mailto:support@agentronics.dev" style={linkBtn}>Email support</a>
            <a href="https://agentronics.dev/book" style={linkBtn}>Book a call</a>
            <a href={`${DOCS}/reference/changelog`} style={linkBtn}>Changelog</a>
          </div>
        </Card>
      </div>
    </>
  );
}

const linkBtn: React.CSSProperties = {
  padding: "7px 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-strong)",
  color: "var(--content)",
  fontSize: 13,
  fontWeight: 600,
  textDecoration: "none"
};
