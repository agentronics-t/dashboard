"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PluginMeta {
  type: "cloudflare" | "profound" | "scrunch";
  name: string;
  blurb: string;
  configHint: string;
  credentialHint: string;
}

export function PluginCard({
  plugin,
  connected,
  config
}: {
  plugin: PluginMeta;
  connected: boolean;
  config?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [configText, setConfigText] = useState(
    config && Object.keys(config).length ? JSON.stringify(config, null, 2) : plugin.configHint
  );
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(configText || "{}");
    } catch {
      setMsg("Config must be valid JSON");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: plugin.type, config: parsed, secret: secret || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setMsg("Saved — credential stored in Secret Manager.");
      setSecret("");
      setTimeout(() => router.refresh(), 1000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    padding: "9px 11px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)",
    background: "var(--surface)", color: "var(--content)", fontSize: 13, width: "100%", fontFamily: "var(--font-mono)"
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>{plugin.name}</div>
          <div style={{ fontSize: 13, color: "var(--content-muted)", marginTop: 4, lineHeight: 1.5 }}>{plugin.blurb}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: "var(--radius-pill)", background: connected ? "var(--success-bg)" : "var(--surface-raised)", color: connected ? "var(--success)" : "var(--content-muted)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", whiteSpace: "nowrap" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: connected ? "var(--success)" : "var(--content-muted)" }} />
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      <button
        onClick={() => setOpenForm((o) => !o)}
        style={{ alignSelf: "flex-start", padding: "8px 14px", borderRadius: "var(--radius-md)", border: connected ? "1px solid var(--border-strong)" : "none", background: connected ? "transparent" : "var(--brand-solid)", color: connected ? "var(--content)" : "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
      >
        {openForm ? "Close" : connected ? "Reconfigure" : "Connect"}
      </button>

      {openForm && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--content-secondary)" }}>Config (JSON)</label>
          <textarea value={configText} onChange={(e) => setConfigText(e.target.value)} rows={2} style={{ ...field, resize: "vertical" }} />
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--content-secondary)" }}>{plugin.credentialHint} (→ Secret Manager, never the DB)</label>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="API token / key" style={field} />
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={save} disabled={busy} style={{ padding: "8px 14px", borderRadius: "var(--radius-md)", border: "none", background: "var(--brand-solid)", color: "#fff", fontWeight: 600, fontSize: 13, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
              {busy ? "Saving…" : "Save"}
            </button>
            {msg && <span style={{ fontSize: 12, color: "var(--content-muted)" }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
