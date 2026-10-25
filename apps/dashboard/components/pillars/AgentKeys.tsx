"use client";

import { useState, useTransition } from "react";
import { Badge, Card, CardTitle } from "@/components/ui";

interface Row {
  id: string;
  agentId: string;
  name: string;
  vendor: string | null;
  prefix: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
}

const input: React.CSSProperties = {
  padding: "8px 11px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-strong)",
  background: "var(--canvas)",
  color: "var(--content)",
  fontSize: 14,
  outline: "none",
  minWidth: 0
};

export function AgentKeys({
  keys,
  agentKeysEnv,
  limit,
  mint,
  revoke
}: {
  keys: Row[];
  /** The AGENT_KEYS env value: { sha256: identity } for active keys. */
  agentKeysEnv: string;
  /** Active keys the plan allows ("Unlimited" or a number as text). */
  limit: string;
  mint: (input: { name: string; vendor?: string }) => Promise<{ key: string; agentId: string }>;
  revoke: (id: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [fresh, setFresh] = useState<{ key: string; agentId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (text: string, what: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  const active = keys.filter((k) => !k.revokedAt);

  return (
    <Card>
      <CardTitle>Agent API keys</CardTitle>
      <p style={{ margin: "0 0 14px", color: "var(--content-secondary)", fontSize: 14, lineHeight: 1.55 }}>
        Give each agent you or your partners run its own key. Agents send it as <code>Authorization: Bearer agk_…</code>. Your
        server checks it live with <code>keyVerifier()</code>, so revoking a key here takes effect within a minute.{" "}
        <span style={{ color: "var(--content-muted)" }}>
          {active.length} of {limit} active.
        </span>
      </p>

      {fresh && (
        <div style={{ background: "var(--brand-soft)", border: "1px solid var(--brand)", borderRadius: "var(--radius-md)", padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Key for <code>{fresh.agentId}</code> — copy it now, it won&apos;t be shown again.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code style={{ fontSize: 13, wordBreak: "break-all", fontFamily: "var(--font-mono)", flex: 1 }}>{fresh.key}</code>
            <button type="button" onClick={() => copy(fresh.key, "key")} style={smallBtn}>
              {copied === "key" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" style={{ marginBottom: 12, fontSize: 13, color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            try {
              setFresh(await mint({ name, vendor }));
              setName("");
              setVendor("");
            } catch (err) {
              setError((err as Error).message);
            }
          });
        }}
        style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name (e.g. Booking agent)" required maxLength={80} style={{ ...input, flex: 2 }} />
        <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor (optional)" maxLength={80} style={{ ...input, flex: 1 }} />
        <button type="submit" disabled={pending} style={{ ...primaryBtn, opacity: pending ? 0.6 : 1 }}>
          Create key
        </button>
      </form>

      <div style={{ display: "flex", flexDirection: "column", marginBottom: 16 }}>
        {keys.length === 0 && <div style={{ color: "var(--content-muted)", fontSize: 13, padding: "6px 2px" }}>No agent keys yet.</div>}
        {keys.map((k) => (
          <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 2px", borderTop: "1px solid var(--border)", fontSize: 13, flexWrap: "wrap" }}>
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--content-secondary)" }}>{k.prefix}…</code>
            <span style={{ fontWeight: 600 }}>{k.name}</span>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--content-muted)" }}>key:{k.agentId}</code>
            {k.vendor && <span style={{ color: "var(--content-muted)" }}>{k.vendor}</span>}
            {k.revokedAt ? <Badge kind="failed">revoked</Badge> : <Badge kind="succeeded">active</Badge>}
            <span style={{ marginLeft: "auto", color: "var(--content-muted)" }}>
              {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : `created ${new Date(k.createdAt).toLocaleDateString()}`}
            </span>
            {!k.revokedAt && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Revoke the key for ${k.name}? Agents using it stop being verified within a minute.`)) start(() => revoke(k.id));
                }}
                style={{ ...smallBtn, color: "var(--danger)" }}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>

      <details>
        <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 650 }}>Verify offline instead (AGENT_KEYS)</summary>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0 6px" }}>
          <span style={{ fontSize: 13 }}>
            <code>AGENT_KEYS</code> · {active.length} active
          </span>
          <button type="button" onClick={() => copy(agentKeysEnv, "env")} style={smallBtn}>
            {copied === "env" ? "Copied" : "Copy"}
          </button>
        </div>
        <pre style={{ margin: 0, padding: 12, borderRadius: "var(--radius-md)", background: "var(--surface-raised)", fontSize: 12, overflowX: "auto", maxHeight: 160 }}>
          <code>{agentKeysEnv}</code>
        </pre>
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--content-muted)", lineHeight: 1.55 }}>
          For servers that can&apos;t call out: set this as <code>AGENT_KEYS</code> and use <code>staticKeyVerifier()</code>. It holds SHA-256
          hashes only — never the keys — and changes take effect on your next deploy.
        </p>
      </details>
    </Card>
  );
}

const smallBtn: React.CSSProperties = {
  border: "1px solid var(--border-strong)",
  background: "transparent",
  color: "var(--content)",
  borderRadius: "var(--radius-md)",
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer"
};

const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--action)",
  color: "var(--action-content)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer"
};
