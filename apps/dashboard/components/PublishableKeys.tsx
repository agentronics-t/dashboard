"use client";

import { useState, useTransition } from "react";
import { Badge, Card, CardTitle } from "@/components/ui";

interface Row {
  id: string;
  key: string;
  label: string;
  allowedOrigins: string[];
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
}

export function PublishableKeys({
  keys,
  apiUrl,
  mint,
  updateOrigins,
  revoke
}: {
  keys: Row[];
  apiUrl: string;
  mint: (input: { label: string; origins: string }) => Promise<{ key: string }>;
  updateOrigins: (id: string, origins: string) => Promise<void>;
  revoke: (id: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [originsText, setOriginsText] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <Card>
      <CardTitle>Publishable keys</CardTitle>
      <p className="ag-muted" style={{ margin: "-6px 0 14px", fontSize: 14, lineHeight: 1.55 }}>
        For the browser SDK — <code>Agentronics.init(&#123; publishableKey &#125;)</code>. Safe in page source: it can read your rules, approved
        tool descriptions and site memory, and send traces and tool registries <strong>only from the origins you list</strong>. Calls go to{" "}
        <code>{apiUrl}/v1/pub</code>.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await mint({ label, origins: originsText });
            setLabel("");
            setOriginsText("");
          });
        }}
        style={{ display: "grid", gap: 8, marginBottom: 14 }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="ag-input" style={{ flex: "1 1 160px" }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. production)" maxLength={80} />
          <input
            className="ag-input"
            style={{ flex: "3 1 260px" }}
            value={originsText}
            onChange={(e) => setOriginsText(e.target.value)}
            placeholder="Allowed origins, e.g. https://shop.example, https://www.shop.example"
          />
          <button type="submit" className="ag-btn ag-btn-primary" disabled={pending}>
            Create key
          </button>
        </div>
      </form>
      {error && (
        <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>
          {error}
        </div>
      )}

      {keys.length === 0 && <div className="ag-muted" style={{ fontSize: 13 }}>No publishable keys yet.</div>}
      {keys.map((k) => (
        <div key={k.id} style={{ borderTop: "1px solid var(--border)", padding: "10px 2px", display: "grid", gap: 6, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <code style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{k.key}</code>
            {!k.revokedAt && (
              <button type="button" className="ag-btn ag-btn-sm" onClick={() => copy(k.key)}>
                {copied === k.key ? "Copied" : "Copy"}
              </button>
            )}
            <span style={{ fontWeight: 600 }}>{k.label}</span>
            {k.revokedAt ? <Badge kind="failed">revoked</Badge> : <Badge kind="succeeded">active</Badge>}
            <span className="ag-muted" style={{ marginLeft: "auto" }}>
              {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : `created ${new Date(k.createdAt).toLocaleDateString()}`}
            </span>
          </div>
          {editing === k.id ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input className="ag-input" style={{ flex: "1 1 280px" }} value={editText} onChange={(e) => setEditText(e.target.value)} />
              <button type="button" className="ag-btn ag-btn-sm ag-btn-primary" disabled={pending} onClick={() => run(async () => { await updateOrigins(k.id, editText); setEditing(null); })}>
                Save
              </button>
              <button type="button" className="ag-btn ag-btn-sm" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="ag-muted">
                {k.allowedOrigins.length ? `Writes from: ${k.allowedOrigins.join(", ")}` : "Read-only — add an origin to send traces"}
              </span>
              {!k.revokedAt && (
                <>
                  <button type="button" className="ag-btn ag-btn-sm" onClick={() => { setEditing(k.id); setEditText(k.allowedOrigins.join(", ")); }}>
                    Edit origins
                  </button>
                  <button
                    type="button"
                    className="ag-btn ag-btn-sm"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Revoke ${k.label}? Pages using it stop syncing within a minute.`)) run(() => revoke(k.id));
                    }}
                  >
                    Revoke
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
