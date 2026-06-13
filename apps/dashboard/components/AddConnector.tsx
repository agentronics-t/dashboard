"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const TYPES = ["cloudflare", "profound", "scrunch"] as const;
const CONFIG_HINT: Record<string, string> = {
  cloudflare: '{"zone_tag":"<your-zone-id>"}',
  profound: "{}",
  scrunch: "{}"
};

export function AddConnector() {
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPES)[number]>("cloudflare");
  const [config, setConfig] = useState(CONFIG_HINT.cloudflare!);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(config || "{}");
    } catch {
      setMsg("Config must be valid JSON");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, config: parsed, secret: secret || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setMsg("Connector saved — credential stored in Secret Manager.");
      setSecret("");
      setTimeout(() => router.refresh(), 1000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  const field: React.CSSProperties = {
    padding: "10px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)",
    background: "var(--surface)", color: "var(--content)", fontSize: 14, width: "100%", fontFamily: "var(--font-mono)"
  };
  const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "var(--content-secondary)", marginBottom: 6, display: "block" };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={lbl}>Source</label>
        <select value={type} onChange={(e) => { const t = e.target.value as typeof type; setType(t); setConfig(CONFIG_HINT[t]!); }} style={{ ...field, fontFamily: "var(--font-sans)" }}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label style={lbl}>Config (JSON, non-secret)</label>
        <textarea value={config} onChange={(e) => setConfig(e.target.value)} rows={3} style={{ ...field, resize: "vertical" }} />
      </div>
      <div>
        <label style={lbl}>Credential (stored in Secret Manager, never in the database)</label>
        <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="API token / key" style={field} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button type="submit" disabled={busy} style={{ padding: "9px 16px", borderRadius: "var(--radius-md)", border: "none", background: "var(--brand-solid)", color: "#fff", fontWeight: 600, fontSize: 14, cursor: busy ? "default" : "pointer", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Saving…" : "Save connector"}
        </button>
        {msg && <span style={{ fontSize: 12.5, color: "var(--content-muted)" }}>{msg}</span>}
      </div>
    </form>
  );
}
