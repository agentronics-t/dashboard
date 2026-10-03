"use client";

import { useMemo, useState } from "react";
import type { Tier } from "@/lib/billing/plans";

type MethodId = "web-bot-auth" | "api-key" | "verified-crawler" | "oauth2" | "browser" | "sso" | "spiffe" | "mtls";

interface MethodSpec {
  id: MethodId;
  name: string;
  body: string;
  minTier: Tier;
  docs: string;
  /** Part of the middleware config (toggleable) vs configured elsewhere. */
  middleware: boolean;
  usageKeys: string[];
}

const DOCS = "https://agentronics.dev/docs";

const METHODS: MethodSpec[] = [
  { id: "web-bot-auth", name: "Web Bot Auth", body: "Cryptographically signed agents (RFC 9421), e.g. OpenAI's ChatGPT agent. No setup for agent operators.", minTier: "free", docs: `${DOCS}/auth/web-bot-auth`, middleware: true, usageKeys: ["web-bot-auth"] },
  { id: "verified-crawler", name: "Verified crawlers", body: "Googlebot, Bingbot, Applebot and others, confirmed by forward-confirmed reverse DNS.", minTier: "free", docs: `${DOCS}/auth/verified-crawlers`, middleware: true, usageKeys: ["verified-crawler"] },
  { id: "api-key", name: "Agent API keys", body: "Keys you issue to your own and your customers' agents. Manage them under API keys.", minTier: "free", docs: `${DOCS}/auth/api-keys`, middleware: true, usageKeys: ["api-key"] },
  { id: "oauth2", name: "OAuth2", body: "Client-credentials access tokens from your identity provider (Auth0, Okta, Entra…).", minTier: "pro", docs: `${DOCS}/auth/oauth2`, middleware: true, usageKeys: ["oauth2"] },
  { id: "browser", name: "WebMCP & browser agents", body: "Agents operating your pages, via the browser SDK.", minTier: "free", docs: `${DOCS}/auth/browser-agents`, middleware: false, usageKeys: ["bearer", "extension", "session-link", "x-agent-header", "declaration", "detection"] },
  { id: "sso", name: "SSO / OIDC", body: "Agents signing in through your IdP with OIDC ID tokens.", minTier: "business", docs: `${DOCS}/auth/sso`, middleware: false, usageKeys: ["sso"] },
  { id: "spiffe", name: "SPIFFE", body: "Workload identity with JWT-SVIDs, including Google agent identities.", minTier: "business", docs: `${DOCS}/auth/spiffe`, middleware: false, usageKeys: ["spiffe", "google-agent"] },
  { id: "mtls", name: "mTLS", body: "Client-certificate agents behind your proxy (XFCC).", minTier: "business", docs: `${DOCS}/auth/mtls`, middleware: false, usageKeys: ["mtls"] }
];

const RANK: Record<Tier, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };
const TIER_NAME: Record<Tier, string> = { free: "Free", pro: "Pro", business: "Business", enterprise: "Enterprise" };

export function AuthConfigurator({
  tier,
  usage
}: {
  tier: Tier;
  usage: Record<string, { verified: number; failed: number }>;
}) {
  const allowed = (m: MethodSpec) => RANK[tier] >= RANK[m.minTier];
  const [on, setOn] = useState<Record<string, boolean>>({ "web-bot-auth": true, "verified-crawler": true, "api-key": true, oauth2: false });
  const [issuer, setIssuer] = useState("https://auth.example.com");
  const [audience, setAudience] = useState("https://your-site.example");
  const [copied, setCopied] = useState(false);

  const snippet = useMemo(() => {
    const lines: string[] = [];
    if (!on["web-bot-auth"]) lines.push("  webBotAuth: false,");
    if (!on["verified-crawler"]) lines.push("  crawlers: false,");
    if (on["api-key"]) lines.push("  apiKey: { verify: staticKeyVerifier(JSON.parse(process.env.AGENT_KEYS ?? '{}')) },");
    if (on.oauth2) lines.push(`  oauth2: { issuer: ${JSON.stringify(issuer)}, audience: ${JSON.stringify(audience)} },`);
    const imports = [
      "import { agentronicsMiddleware } from '@agentronics/sdk/next'",
      ...(on["api-key"] ? ["import { staticKeyVerifier } from '@agentronics/sdk/server'"] : [])
    ];
    return [
      "// middleware.ts",
      ...imports,
      "",
      lines.length ? `export default agentronicsMiddleware({\n${lines.join("\n")}\n})` : "export default agentronicsMiddleware()",
      "",
      "export const config = {",
      "  matcher: ['/((?!_next|.*\\\\..*).*)'],",
      "  runtime: 'nodejs',",
      "}"
    ].join("\n");
  }, [on, issuer, audience]);

  const card = (m: MethodSpec) => {
    const u = m.usageKeys.reduce(
      (acc, k) => ({ verified: acc.verified + (usage[k]?.verified ?? 0), failed: acc.failed + (usage[k]?.failed ?? 0) }),
      { verified: 0, failed: 0 }
    );
    const ok = allowed(m);
    return (
      <div
        key={m.id}
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg, 12px)",
          padding: 16,
          background: "var(--surface)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          opacity: ok ? 1 : 0.75
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{m.name}</span>
          {m.minTier !== "free" && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-solid)", background: "var(--brand-soft)", padding: "2px 7px", borderRadius: 999 }}>
              {TIER_NAME[m.minTier]}+
            </span>
          )}
          {m.middleware && (
            <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: ok ? "pointer" : "not-allowed" }}>
              <input
                type="checkbox"
                checked={ok && !!on[m.id]}
                disabled={!ok}
                onChange={(e) => setOn((s) => ({ ...s, [m.id]: e.target.checked }))}
              />
              {ok && on[m.id] ? "On" : "Off"}
            </label>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--content-secondary)", lineHeight: 1.55 }}>{m.body}</p>
        {m.id === "oauth2" && ok && on.oauth2 && (
          <div style={{ display: "grid", gap: 6 }}>
            {[
              ["Issuer", issuer, setIssuer],
              ["Audience", audience, setAudience]
            ].map(([label, value, set]) => (
              <label key={label as string} style={{ fontSize: 12, color: "var(--content-muted)", display: "grid", gap: 3 }}>
                {label as string}
                <input
                  value={value as string}
                  onChange={(e) => (set as (v: string) => void)(e.target.value)}
                  style={{ padding: "6px 9px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--canvas)", color: "var(--content)", fontSize: 13 }}
                />
              </label>
            ))}
          </div>
        )}
        <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "var(--content-muted)", paddingTop: 4 }}>
          <span>
            {u.verified + u.failed > 0 ? `${u.verified.toLocaleString()} verified · ${u.failed.toLocaleString()} failed · 30d` : "No sign-ins yet"}
          </span>
          {ok ? (
            <a href={m.docs} style={{ color: "var(--brand)" }}>
              Docs →
            </a>
          ) : (
            <a href="/billing" style={{ color: "var(--brand)", fontWeight: 600 }}>
              Upgrade →
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--content-muted)", margin: "0 0 10px" }}>
          Server methods · in your middleware
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {METHODS.filter((m) => m.middleware).map(card)}
        </div>
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--content-muted)", margin: 0 }}>
            Your middleware config
          </h2>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(snippet);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            style={{ padding: "6px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--content)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <pre style={{ margin: 0, padding: 14, borderRadius: "var(--radius-md)", background: "var(--surface-raised)", fontSize: 12.5, lineHeight: 1.6, overflowX: "auto" }}>
          <code>{snippet}</code>
        </pre>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--content-muted)" }}>
          Configuration lives in your code, so changes ship with your next deploy. Express and other runtimes take the same
          options — see the{" "}
          <a href={`${DOCS}/reference/server-api`} style={{ color: "var(--brand)" }}>
            server API
          </a>
          .
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--content-muted)", margin: "0 0 10px" }}>
          Browser & enterprise identity
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {METHODS.filter((m) => !m.middleware).map(card)}
        </div>
      </section>
    </div>
  );
}
