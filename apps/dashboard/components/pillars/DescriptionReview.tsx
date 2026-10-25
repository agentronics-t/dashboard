"use client";

import { useState, useTransition } from "react";
import { decideDescription, suggestDescriptions } from "@/app/(app)/knaph/actions";
import { Badge, fmt } from "@/components/ui";

export interface DescriptionItem {
  siteId: string;
  toolName: string;
  page: string | null;
  original: string;
  originalTokens: number;
  suggestion: {
    text: string;
    tokens: number;
    status: "suggested" | "approved" | "rejected";
    rationale: string | null;
    model: string | null;
  } | null;
}

const STATUS: Record<string, { label: string; kind: string }> = {
  suggested: { label: "Suggested", kind: "info" },
  approved: { label: "Live", kind: "succeeded" },
  rejected: { label: "Original", kind: "queued" }
};

export function GenerateButton({ siteId, label = "Write descriptions", disabledReason }: { siteId: string; label?: string; disabledReason?: string | null }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button
        type="button"
        className="ag-btn ag-btn-primary ag-btn-sm"
        disabled={pending || !!disabledReason}
        title={disabledReason ?? undefined}
        onClick={() =>
          start(async () => {
            setNote(null);
            try {
              const r = await suggestDescriptions(siteId);
              setNote(r.suggested ? `${r.suggested} suggestions${r.model === "rules" ? " (rule-based — connect Vertex AI for Gemini)" : ""}` : "No tools with descriptions yet.");
            } catch (e) {
              setNote((e as Error).message);
            }
          })
        }
      >
        {pending ? "Writing…" : label}
      </button>
      {note && <span className="ag-muted" style={{ fontSize: 12.5 }}>{note}</span>}
    </span>
  );
}

export function DescriptionReview({ items }: { items: DescriptionItem[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (it: DescriptionItem, decision: "approved" | "rejected" | "suggested", edited?: string) =>
    start(async () => {
      setError(null);
      try {
        await decideDescription({ siteId: it.siteId, toolName: it.toolName, decision, ...(edited !== undefined ? { text: edited } : {}) });
        setEditing(null);
      } catch (e) {
        setError((e as Error).message);
      }
    });

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {error && (
        <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>
          {error}
        </div>
      )}
      {items.map((it) => {
        const key = `${it.siteId}|${it.toolName}`;
        const s = it.suggestion;
        const saved = s ? it.originalTokens - s.tokens : 0;
        return (
          <div key={key} style={{ borderTop: "1px solid var(--border)", padding: "14px 2px", display: "grid", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span className="ag-mono" style={{ fontWeight: 700 }}>{it.toolName}</span>
              {it.page && <span className="ag-muted ag-mono" style={{ fontSize: 12 }}>{it.page}</span>}
              {s && <Badge kind={STATUS[s.status]!.kind}>{STATUS[s.status]!.label}</Badge>}
              <span className="ag-muted ag-mono" style={{ marginLeft: "auto", fontSize: 12 }}>
                {fmt(it.originalTokens)} tokens
                {s && s.text !== it.original && (
                  <>
                    {" "}→ <strong style={{ color: saved > 0 ? "var(--success)" : "var(--content)" }}>{fmt(s.tokens)}</strong>
                    {saved > 0 && ` (−${Math.round((saved / it.originalTokens) * 100)}%)`}
                  </>
                )}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
              <div>
                <div className="ag-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                  In your code
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{it.original}</div>
              </div>
              <div>
                <div className="ag-muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>
                  What agents see{s?.model && s.model !== "rules" ? ` · written by ${s.model}` : ""}
                </div>
                {editing === key ? (
                  <textarea
                    className="ag-input"
                    style={{ width: "100%", minHeight: 70, fontSize: 13.5, lineHeight: 1.5 }}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                ) : (
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    {s && s.status !== "rejected" ? s.text : <span className="ag-muted">The original, until you approve a rewrite.</span>}
                  </div>
                )}
                {s?.rationale && editing !== key && <div className="ag-muted" style={{ fontSize: 12, marginTop: 4 }}>{s.rationale}</div>}
              </div>
            </div>
            {s && !(s.status === "rejected" && s.text === it.original && editing !== key) && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {editing === key ? (
                  <>
                    <button type="button" className="ag-btn ag-btn-primary ag-btn-sm" disabled={pending} onClick={() => act(it, "approved", text)}>
                      Save &amp; approve
                    </button>
                    <button type="button" className="ag-btn ag-btn-sm" disabled={pending} onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {s.status !== "approved" && (
                      <button type="button" className="ag-btn ag-btn-primary ag-btn-sm" disabled={pending} onClick={() => act(it, "approved")}>
                        Approve
                      </button>
                    )}
                    <button
                      type="button"
                      className="ag-btn ag-btn-sm"
                      disabled={pending}
                      onClick={() => {
                        setEditing(key);
                        setText(s.text);
                      }}
                    >
                      Edit
                    </button>
                    {s.status !== "rejected" && (
                      <button type="button" className="ag-btn ag-btn-sm" disabled={pending} onClick={() => act(it, "rejected")}>
                        {s.status === "approved" ? "Go back to original" : "Keep original"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
