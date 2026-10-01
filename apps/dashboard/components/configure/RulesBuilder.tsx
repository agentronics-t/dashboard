"use client";

import { useState } from "react";

export interface RuleAgent {
  identity: string;
  name: string;
  verified: boolean;
  requests: number;
}

const parseList = (s: string) =>
  s
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 200);

/** Mirrors decide() in @agentronics/sdk/server so the preview matches production. */
function decide(a: RuleAgent, unverified: "allow" | "block", block: string[], allow: string[] | null) {
  const keys = [a.identity, a.name].map((x) => x.toLowerCase());
  const hit = (list: string[]) => list.some((x) => keys.includes(x.toLowerCase()));
  if (!a.verified) return unverified === "block" ? "block" : "allow";
  if (hit(block)) return "block";
  if (allow && !hit(allow)) return "block";
  return "allow";
}

const box = { padding: "8px 10px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--canvas)", color: "var(--content)", fontSize: 13, fontFamily: "var(--font-mono)", width: "100%", minHeight: 76, resize: "vertical" as const };

export function RulesBuilder({ agents, listsAllowed }: { agents: RuleAgent[]; listsAllowed: boolean }) {
  const [unverified, setUnverified] = useState<"allow" | "block">("allow");
  const [blockText, setBlockText] = useState("");
  const [allowOn, setAllowOn] = useState(false);
  const [allowText, setAllowText] = useState("");
  const [copied, setCopied] = useState(false);

  const block = listsAllowed ? parseList(blockText) : [];
  const allow = listsAllowed && allowOn ? parseList(allowText) : null;

  // Cheap to recompute (≤ 500 agents) — no memoisation needed.
  const blockedAgents = agents.filter((a) => decide(a, unverified, block, allow) === "block");
  const impact = { agents: blockedAgents, requests: blockedAgents.reduce((n, a) => n + a.requests, 0) };

  const parts = [`  unverified: '${unverified}',`];
  if (block.length) parts.push(`  block: ${JSON.stringify(block)},`);
  if (allow) parts.push(`  allow: ${JSON.stringify(allow)},`);
  const snippet = `agentronicsMiddleware({\n  // …your authentication options\n  rules: {\n${parts.map((p) => "  " + p).join("\n")}\n  },\n})`;

  const total = agents.reduce((n, a) => n + a.requests, 0);
  const label = { fontSize: 13, fontWeight: 650, marginBottom: 6, display: "block" } as const;
  const hint = { fontSize: 12, color: "var(--content-muted)", margin: "4px 0 0" } as const;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <span style={label}>Unverified agents</span>
          <div style={{ display: "grid", gap: 8 }}>
            {(["allow", "block"] as const).map((v) => (
              <label key={v} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: "var(--radius-md)", border: `1px solid ${unverified === v ? "var(--brand-solid)" : "var(--border)"}`, cursor: "pointer", background: "var(--surface)" }}>
                <input type="radio" name="unverified" checked={unverified === v} onChange={() => setUnverified(v)} style={{ marginTop: 3 }} />
                <span>
                  <span style={{ fontWeight: 650, fontSize: 14 }}>{v === "allow" ? "Allow and log (monitor mode)" : "Block"}</span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--content-secondary)", marginTop: 2 }}>
                    {v === "allow"
                      ? "Agents without a valid credential get through and show up as unverified in your logs."
                      : "Agents without a valid credential get a 403. Humans are never affected."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div style={{ opacity: listsAllowed ? 1 : 0.6 }}>
          <span style={label}>
            Block list {!listsAllowed && <a href="/billing" style={{ color: "var(--brand)", fontWeight: 600, fontSize: 12, marginLeft: 6 }}>Pro+ · Upgrade →</a>}
          </span>
          <textarea disabled={!listsAllowed} value={blockText} onChange={(e) => setBlockText(e.target.value)} placeholder={"Bytespider\ncrawler:CCBot"} style={box} />
          <p style={hint}>Blocked even when verified. Match an agent id, name or vendor — one per line.</p>
        </div>

        <div style={{ opacity: listsAllowed ? 1 : 0.6 }}>
          <label style={{ ...label, display: "flex", alignItems: "center", gap: 8, cursor: listsAllowed ? "pointer" : "not-allowed" }}>
            <input type="checkbox" disabled={!listsAllowed} checked={allowOn} onChange={(e) => setAllowOn(e.target.checked)} />
            Allowlist mode
          </label>
          {allowOn && listsAllowed && (
            <>
              <textarea value={allowText} onChange={(e) => setAllowText(e.target.value)} placeholder={"https://chatgpt.com\ncrawler:Googlebot\nkey:booking-agent"} style={box} />
              <p style={hint}>Only these verified agents get in. An empty allowlist blocks every agent.</p>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg, 12px)", padding: 16, background: "var(--surface)" }}>
          <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 4 }}>Impact preview · last 7 days</div>
          <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>
            {impact.agents.length} {impact.agents.length === 1 ? "agent" : "agents"} blocked
          </div>
          <div style={{ fontSize: 13, color: "var(--content-muted)" }}>
            {impact.requests.toLocaleString()} of {total.toLocaleString()} agent sign-ins would have been refused
          </div>
          {impact.agents.length > 0 && (
            <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {impact.agents.slice(0, 50).map((a) => (
                <li key={a.identity} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                  <span>
                    {a.name} <span style={{ color: "var(--content-muted)" }}>{a.verified ? "· verified" : "· unverified"}</span>
                  </span>
                  <span style={{ color: "var(--content-muted)" }}>{a.requests.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 650 }}>Rules config</span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              style={{ padding: "5px 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--content)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre style={{ margin: 0, padding: 14, borderRadius: "var(--radius-md)", background: "var(--surface-raised)", fontSize: 12.5, lineHeight: 1.6, overflowX: "auto" }}>
            <code>{snippet}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
