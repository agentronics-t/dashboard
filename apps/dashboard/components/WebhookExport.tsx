"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge, Card, CardTitle } from "@/components/ui";

export interface WebhookRow {
  url: string;
  enabled: boolean;
  failures: number;
  lastStatus: string | null;
  lastDeliveryAt: Date | string | null;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "8px 11px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border-strong)",
  background: "var(--canvas)",
  color: "var(--content)",
  fontSize: 14,
  outline: "none"
};

const btn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--action)",
  color: "var(--action-content)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer"
};

const ghost: React.CSSProperties = {
  border: "1px solid var(--border-strong)",
  background: "transparent",
  color: "var(--content)",
  borderRadius: "var(--radius-md)",
  padding: "5px 11px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer"
};

const p: React.CSSProperties = { margin: "0 0 14px", color: "var(--content-secondary)", fontSize: 14, lineHeight: 1.55 };

export function WebhookExport({
  included,
  lockedNote,
  hook,
  save,
  remove,
  reveal,
  rotate,
  test
}: {
  included: boolean;
  lockedNote: string;
  hook: WebhookRow | null;
  save: (url: string) => Promise<{ error?: string }>;
  remove: () => Promise<void>;
  reveal: () => Promise<string>;
  rotate: () => Promise<string>;
  test: () => Promise<{ ok: boolean; status: string }>;
}) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState(hook?.url ?? "");
  const [secret, setSecret] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setNote(null);
      try {
        await fn();
      } catch (e) {
        setNote({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
      }
    });

  if (!included) {
    return (
      <Card>
        <CardTitle>Webhooks</CardTitle>
        <p style={p}>Send every SDK event (agent visits, tool calls, Authz decisions) to your own endpoint as it happens.</p>
        <p style={{ ...p, margin: 0 }}>
          {lockedNote}{" "}
          <Link className="ag-link" href="/account">
            See plans
          </Link>
        </p>
      </Card>
    );
  }

  const status = !hook
    ? null
    : !hook.enabled
      ? <Badge kind="failed">paused after repeated failures</Badge>
      : hook.failures > 0
        ? <Badge kind="failed">retrying ({hook.lastStatus})</Badge>
        : <Badge kind="succeeded">active</Badge>;

  return (
    <Card>
      <CardTitle>Webhooks</CardTitle>
      <p style={p}>
        We POST new SDK events to this HTTPS endpoint about once a minute, up to 200 per request, as{" "}
        <code>{`{ "type": "events.batch", "data": { "events": [...] } }`}</code>. Each request is signed with the{" "}
        <a className="ag-link" href="https://www.standardwebhooks.com/" target="_blank" rel="noreferrer">
          Standard Webhooks
        </a>{" "}
        scheme: check the <code>webhook-signature</code> header with the secret below. Reply with any 2xx; anything else is retried with backoff.
      </p>

      <form
        style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await save(url);
            setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: hook ? "Endpoint saved." : "Endpoint added. Events from now on will be sent to it." });
          });
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/hooks/agentronics"
          aria-label="Webhook URL"
          type="url"
          required
          style={inputStyle}
        />
        <button type="submit" style={{ ...btn, opacity: pending ? 0.6 : 1 }} disabled={pending}>
          {hook ? (hook.enabled ? "Save" : "Save and resume") : "Add endpoint"}
        </button>
      </form>

      {hook && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
          {status}
          <span style={{ color: "var(--content-muted)" }}>
            {hook.lastDeliveryAt ? `last delivery ${new Date(hook.lastDeliveryAt).toLocaleString()}` : "no deliveries yet"}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={ghost}
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await test();
                  setNote({ ok: r.ok, text: r.ok ? `Test delivered (${r.status}).` : `Test failed: ${r.status}.` });
                })
              }
            >
              Send test
            </button>
            <button type="button" style={ghost} disabled={pending} onClick={() => run(async () => setSecret(await reveal()))}>
              Show secret
            </button>
            <button
              type="button"
              style={ghost}
              disabled={pending}
              onClick={() => {
                if (confirm("Rotate the signing secret? Deliveries are signed with the new one straight away.")) run(async () => setSecret(await rotate()));
              }}
            >
              Rotate secret
            </button>
            <button
              type="button"
              style={{ ...ghost, color: "var(--danger)" }}
              disabled={pending}
              onClick={() => {
                if (confirm("Remove this endpoint? Deliveries stop.")) run(async () => {
                  await remove();
                  setUrl("");
                  setSecret(null);
                });
              }}
            >
              Remove
            </button>
          </span>
        </div>
      )}

      {secret && (
        <div style={{ marginTop: 12, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px" }}>
          <div style={{ fontSize: 12, color: "var(--content-muted)", marginBottom: 4 }}>Signing secret (keep it server-side)</div>
          <code style={{ fontSize: 13, wordBreak: "break-all", fontFamily: "var(--font-mono)" }}>{secret}</code>
        </div>
      )}

      {note && (
        <p role="status" style={{ margin: "12px 0 0", fontSize: 13, color: note.ok ? "var(--content-secondary)" : "var(--danger)" }}>
          {note.text}
        </p>
      )}
    </Card>
  );
}
