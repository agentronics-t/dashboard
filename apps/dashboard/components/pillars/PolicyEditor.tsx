"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { deletePolicy, savePolicy } from "@/app/(app)/authz/actions";
import { Badge } from "@/components/ui";
import type { SdkPolicyInput } from "@agentronics/intel-schema";

export interface PolicyRow {
  id: string;
  siteId: string;
  tool: string;
  decision: "allow" | "deny" | "review";
  minTrust: "detected" | "declared" | "verified" | "linked";
  allowedClasses: string[];
  rateLimit: { max: number; windowSeconds: number } | null;
}

export const WHO: Record<PolicyRow["minTrust"], string> = {
  detected: "Any agent",
  declared: "Agents that say who they are",
  verified: "Verified agents",
  linked: "Verified agents acting for a signed-in user"
};
const DECISION: Record<PolicyRow["decision"], { label: string; kind: string; help: string }> = {
  allow: { label: "Allow", kind: "succeeded", help: "The tool runs." },
  review: { label: "Review", kind: "warning", help: "The person on the page approves each call first." },
  deny: { label: "Deny", kind: "failed", help: "The tool can't be called. The agent can still use the site." }
};
const CLASSES = [
  ["webmcp", "WebMCP"],
  ["dom", "Browser automation"],
  ["screenshot", "Vision model"],
  ["crawler", "Crawler"]
] as const;

const blank = (): Omit<PolicyRow, "id"> & { id?: string } => ({
  siteId: "*",
  tool: "",
  decision: "review",
  minTrust: "verified",
  allowedClasses: [],
  rateLimit: null
});

export function PolicyEditor({
  rules,
  tools,
  sites,
  limit,
  used,
  locked,
  rateLimitsIncluded = true
}: {
  rules: PolicyRow[];
  /** Tool names from the synced registry, for autocomplete. */
  tools: string[];
  sites: string[];
  /** Per-agent rate limits are a Pro feature; off = the checkbox is disabled with an upgrade note. */
  rateLimitsIncluded?: boolean;
  /** "Unlimited" or the number of rules the plan allows. */
  limit: string;
  used: number;
  /** Plan has no authorization rules; the reason + upgrade hint. */
  locked: string | null;
}) {
  const [draft, setDraft] = useState<ReturnType<typeof blank> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    if (!draft) return;
    setError(null);
    start(async () => {
      try {
        await savePolicy({ ...draft, tool: draft.tool.trim(), allowedClasses: draft.allowedClasses as SdkPolicyInput["allowedClasses"] });
        setDraft(null);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div>
      <p className="ag-muted" style={{ margin: "-6px 0 14px", fontSize: 13.5, lineHeight: 1.55 }}>
        Rules decide who may call each WebMCP tool. Your SDK pulls them with <code>pullConfig()</code>. A tool with no rule stays callable by any
        agent. {locked ? null : <span>{used} of {limit} rules used.</span>}
      </p>

      {locked ? (
        <div style={{ border: "1px dashed var(--border-strong)", borderRadius: "var(--radius-lg)", padding: 16, fontSize: 14 }}>
          {locked}{" "}
          <Link className="ag-link" href="/account">
            See plans
          </Link>
        </div>
      ) : (
        <>
          <div className="ag-scroll-x">
            <table className="ag-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Site</th>
                  <th>Decision</th>
                  <th>Who may call it</th>
                  <th>Agent types</th>
                  <th>Rate limit</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 && (
                  <tr>
                    <td colSpan={7} className="ag-muted">
                      No rules yet — every tool is callable by any agent.
                    </td>
                  </tr>
                )}
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="ag-mono" style={{ fontWeight: 600 }}>{r.tool}</td>
                    <td className="ag-mono">{r.siteId === "*" ? "all sites" : r.siteId}</td>
                    <td>
                      <Badge kind={DECISION[r.decision].kind}>{DECISION[r.decision].label}</Badge>
                    </td>
                    <td>{WHO[r.minTrust]}</td>
                    <td>{r.allowedClasses.length ? r.allowedClasses.map((c) => CLASSES.find(([id]) => id === c)?.[1] ?? c).join(", ") : "Any"}</td>
                    <td className="ag-mono">{r.rateLimit ? `${r.rateLimit.max} / ${r.rateLimit.windowSeconds}s` : "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button type="button" className="ag-btn ag-btn-sm" onClick={() => setDraft({ ...r })} disabled={pending}>
                        Edit
                      </button>{" "}
                      <button
                        type="button"
                        className="ag-btn ag-btn-sm"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`Delete the rule for ${r.tool}?`)) start(() => deletePolicy(r.id));
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!draft ? (
            <button type="button" className="ag-btn ag-btn-primary" style={{ marginTop: 14 }} onClick={() => setDraft(blank())}>
              Add rule
            </button>
          ) : (
            <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 16, display: "grid", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Tool (use * as a wildcard)
                  <input
                    className="ag-input"
                    list="ag-policy-tools"
                    value={draft.tool}
                    placeholder="checkout or cart.*"
                    onChange={(e) => setDraft({ ...draft, tool: e.target.value })}
                  />
                  <datalist id="ag-policy-tools">
                    {tools.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </label>
                <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Site
                  <select className="ag-select" value={draft.siteId} onChange={(e) => setDraft({ ...draft, siteId: e.target.value })}>
                    <option value="*">All sites</option>
                    {sites.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "grid", gap: 6, fontSize: 13, fontWeight: 600 }}>
                  Who may call it
                  <select
                    className="ag-select"
                    value={draft.minTrust}
                    onChange={(e) => setDraft({ ...draft, minTrust: e.target.value as PolicyRow["minTrust"] })}
                  >
                    {(Object.keys(WHO) as PolicyRow["minTrust"][]).map((k) => (
                      <option key={k} value={k}>
                        {WHO[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
                <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Decision</legend>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {(Object.keys(DECISION) as PolicyRow["decision"][]).map((d) => (
                    <label
                      key={d}
                      style={{
                        flex: "1 1 200px",
                        border: `1px solid ${draft.decision === d ? "var(--brand)" : "var(--border)"}`,
                        borderRadius: "var(--radius-md)",
                        padding: "10px 12px",
                        cursor: "pointer",
                        fontSize: 13
                      }}
                    >
                      <input type="radio" name="decision" checked={draft.decision === d} onChange={() => setDraft({ ...draft, decision: d })} />{" "}
                      <strong>{DECISION[d].label}</strong>
                      <div className="ag-muted" style={{ marginTop: 3 }}>{DECISION[d].help}</div>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Only these agent types (none ticked = any)</legend>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
                  {CLASSES.map(([id, label]) => (
                    <label key={id} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={draft.allowedClasses.includes(id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            allowedClasses: e.target.checked ? [...draft.allowedClasses, id] : draft.allowedClasses.filter((c) => c !== id)
                          })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, flexWrap: "wrap" }}>
                <input
                  type="checkbox"
                  checked={!!draft.rateLimit}
                  disabled={!rateLimitsIncluded && !draft.rateLimit}
                  onChange={(e) => setDraft({ ...draft, rateLimit: e.target.checked ? { max: 10, windowSeconds: 60 } : null })}
                />
                Rate limit each agent to
                {!rateLimitsIncluded && !draft.rateLimit && <span className="ag-muted"> (Pro plan)</span>}
                {draft.rateLimit && (
                  <>
                    <input
                      className="ag-input"
                      type="number"
                      min={1}
                      style={{ width: 80 }}
                      value={draft.rateLimit.max}
                      onChange={(e) => setDraft({ ...draft, rateLimit: { ...draft.rateLimit!, max: Math.max(1, Number(e.target.value)) } })}
                    />
                    calls per
                    <input
                      className="ag-input"
                      type="number"
                      min={1}
                      style={{ width: 90 }}
                      value={draft.rateLimit.windowSeconds}
                      onChange={(e) => setDraft({ ...draft, rateLimit: { ...draft.rateLimit!, windowSeconds: Math.max(1, Number(e.target.value)) } })}
                    />
                    seconds
                  </>
                )}
              </label>

              {error && (
                <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>
                  {error}
                </div>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="ag-btn ag-btn-primary" onClick={save} disabled={pending || !draft.tool.trim()}>
                  {draft.id ? "Save rule" : "Add rule"}
                </button>
                <button type="button" className="ag-btn" onClick={() => setDraft(null)} disabled={pending}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
