"use client";

import { useState, useTransition } from "react";
import { Badge, Card, CardTitle } from "@/components/ui";

interface KeyRow {
  id: string;
  prefix: string;
  label: string;
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 11px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-strong)",
  background: "var(--canvas)",
  color: "var(--content)",
  fontSize: 14,
  outline: "none"
};

const btnStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--brand-solid)",
  color: "#fff",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer"
};

export function SdkKeys({
  keys,
  mint,
  revoke
}: {
  keys: KeyRow[];
  mint: (label: string) => Promise<{ id: string; key: string; prefix: string }>;
  revoke: (id: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  return (
    <Card>
      <CardTitle>SDK ingest keys</CardTitle>
      <p style={{ margin: "0 0 14px", color: "var(--content-secondary)", fontSize: 14, lineHeight: 1.55 }}>
        Stream SDK events from your backend to <code>POST /v1/sdk/events</code> with an{" "}
        <code>Authorization: Bearer &lt;key&gt;</code> header. Keep the key server-side — it is secret and
        must never ship to the browser.
      </p>

      {fresh && (
        <div
          style={{
            background: "var(--brand-soft)",
            border: "1px solid var(--brand)",
            borderRadius: "var(--radius-md)",
            padding: "12px 14px",
            marginBottom: 14
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Copy this key now — it won&apos;t be shown again.
          </div>
          <code style={{ fontSize: 13, wordBreak: "break-all", fontFamily: "var(--font-mono)" }}>{fresh}</code>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. production)"
          style={inputStyle}
        />
        <button
          style={{ ...btnStyle, opacity: pending ? 0.6 : 1 }}
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await mint(label);
              setFresh(r.key);
              setLabel("");
            })
          }
        >
          Create key
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {keys.length === 0 && (
          <div style={{ color: "var(--content-muted)", fontSize: 13, padding: "6px 2px" }}>No keys yet.</div>
        )}
        {keys.map((k) => (
          <div
            key={k.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "9px 2px",
              borderTop: "1px solid var(--border)",
              fontSize: 13
            }}
          >
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--content-secondary)" }}>{k.prefix}…</code>
            <span style={{ fontWeight: 600 }}>{k.label}</span>
            {k.revokedAt ? <Badge kind="failed">revoked</Badge> : <Badge kind="succeeded">active</Badge>}
            <span style={{ marginLeft: "auto", color: "var(--content-muted)" }}>
              {k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : "never used"}
            </span>
            {!k.revokedAt && (
              <button
                onClick={() => start(() => revoke(k.id))}
                disabled={pending}
                style={{
                  border: "1px solid var(--border-strong)",
                  background: "transparent",
                  color: "var(--danger)",
                  borderRadius: "var(--radius-md)",
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
