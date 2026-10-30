"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { cancelRun, submitReview, type SiteFixKind } from "@/app/(app)/agent-nic/actions";
import { PlanChooser, type PlanCard } from "@/components/PlanChooser";
import { Badge } from "@/components/ui";

type Auth = "public" | "signed_in" | "scoped";

export interface ReviewTool {
  id: string;
  page: string;
  name: string;
  kind: string;
  strategy: string;
  description: string;
  risk: string;
  auth: Auth;
  rationale: string;
  inputSchema: unknown;
}

/** A discoverability fix Agent Nic drafted in the "Site files" step. */
export interface ReviewSiteFix {
  kind: SiteFixKind;
  title: string;
  found: string;
  plan: string;
  files: string[];
  preview: string;
}

export interface ReviewPlan {
  id: string;
  name: string;
  toolsPerSite: number | null;
  strategies: string[];
  /** strategy → name of the cheapest plan that includes it */
  unlockedBy: Record<string, string>;
}

const HOW: Record<string, string> = { form: "Form", dom: "On-page action", fetch: "API call", server_action: "Server action" };
const RISK: Record<string, { label: string; kind: string }> = {
  read: { label: "read-only", kind: "succeeded" },
  write: { label: "changes data", kind: "info" },
  payment: { label: "payment", kind: "warning" },
  destructive: { label: "irreversible", kind: "critical" }
};
const AUTH_LABEL: Record<Auth, string> = { public: "Any agent", signed_in: "Signed-in visitors", scoped: "Scoped grant only" };

/** Site fixes that are written with the site's address in them. */

type Choice = Record<string, { approved: boolean; auth: Auth }>;

/** Agent Nic's suggestion, or a safe default from the tool's risk when it has none. */
const defaultAuth = (t: ReviewTool): Auth =>
  t.auth in AUTH_LABEL ? t.auth : t.risk === "read" ? "public" : t.risk === "write" ? "signed_in" : "scoped";

export function ReviewPanel({
  runId,
  tools,
  siteFixes = [],
  detectedUrl = null,
  detectedSource = null,
  plan,
  plans,
  billingReady
}: {
  runId: string;
  tools: ReviewTool[];
  siteFixes?: ReviewSiteFix[];
  /** The address Agent Nic found (GitHub homepage, package.json, metadataBase…), if any. */
  detectedUrl?: string | null;
  /** Where that address came from, in words. */
  detectedSource?: string | null;
  plan: ReviewPlan;
  plans: PlanCard[];
  billingReady: boolean;
}) {
  const router = useRouter();
  const allowed = (t: ReviewTool) => plan.strategies.includes(t.strategy);
  const max = plan.toolsPerSite;
  // Start with every tool the plan includes, up to its per-site limit.
  const [choice, setChoice] = useState<Choice>(() => {
    let left = max ?? Infinity;
    return Object.fromEntries(
      tools.map((t) => {
        const on = allowed(t) && left > 0;
        if (on) left--;
        return [t.id, { approved: on, auth: defaultAuth(t) }];
      })
    );
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Site files are on every plan; all start selected.
  const [siteOn, setSiteOn] = useState<Record<string, boolean>>(() => Object.fromEntries(siteFixes.map((f) => [f.kind, true])));
  const [siteUrl, setSiteUrl] = useState(detectedUrl ?? "");
  const [urlTried, setUrlTried] = useState(false);
  const urlRef = useRef<HTMLInputElement>(null);
  const siteCount = siteFixes.filter((f) => siteOn[f.kind]).length;
  // Every run needs the address: Agent Nic makes the site's SDK key for it.
  const urlNeeded = !siteUrl.trim();

  const byPage = useMemo(() => {
    const m = new Map<string, ReviewTool[]>();
    for (const t of tools) m.set(t.page, [...(m.get(t.page) ?? []), t]);
    return [...m.entries()].sort(([a], [b]) => (a === "*" ? -1 : b === "*" ? 1 : a.localeCompare(b)));
  }, [tools]);

  const approved = tools.filter((t) => choice[t.id]?.approved).length;
  const lockedCount = tools.filter((t) => !allowed(t)).length;
  const overLimit = max !== null && approved > max;
  const set = (id: string, patch: Partial<{ approved: boolean; auth: Auth }>) =>
    setChoice((c) => ({ ...c, [id]: { approved: c[id]?.approved ?? false, auth: c[id]?.auth ?? defaultAuth(tools.find((t) => t.id === id)!), ...patch } }));
  const all = (on: boolean) => {
    let left = max ?? Infinity;
    setChoice((c) =>
      Object.fromEntries(
        tools.map((t) => {
          const v = on && allowed(t) && left > 0;
          if (v) left--;
          return [t.id, { approved: v, auth: c[t.id]?.auth ?? defaultAuth(t) }];
        })
      )
    );
  };

  const approve = () => {
    // The address is the one thing we can't default: point at the field instead of a dead button.
    if (urlNeeded) {
      setUrlTried(true);
      urlRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      urlRef.current?.focus();
      return;
    }
    start(async () => {
      setError(null);
      const res = await submitReview(
        runId,
        tools.map((t) => ({ id: t.id, approved: (choice[t.id]?.approved ?? false) && allowed(t), auth: choice[t.id]?.auth ?? defaultAuth(t) })),
        { siteFiles: siteFixes.map((f) => ({ kind: f.kind, approved: f.kind === "sdk" || !!siteOn[f.kind] })), siteUrl: siteUrl.trim() || null }
      );
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  };

  const cancel = () =>
    start(async () => {
      const res = await cancelRun(runId);
      if (!res.ok) setError(res.error);
      router.refresh();
    });

  const needsUpgrade = lockedCount > 0 || overLimit || (max !== null && tools.filter(allowed).length > max);

  const label = [approved ? `${approved} tool${approved === 1 ? "" : "s"}` : "", siteCount ? `${siteCount} site file${siteCount === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(" + ");

  const approveButton = (
    <button className="ag-btn ag-btn-primary" onClick={approve} disabled={pending || (approved === 0 && siteCount === 0) || overLimit}>
      {pending ? "Working…" : `Approve ${label || "nothing"} & write the code`}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* The same button as at the end, so a long list doesn't have to be scrolled through. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", background: "var(--surface-sunken, transparent)" }}>
        <span style={{ fontSize: 13.5, flex: "1 1 220px" }}>
          Everything is ticked with a sensible default. Approve now, or change anything below first.
        </span>
        {approveButton}
        {error && (
          <span role="alert" style={{ color: "var(--danger)", fontSize: 13, flexBasis: "100%" }}>
            {error}
          </span>
        )}
      </div>
      <section>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--content-muted)", marginBottom: 6 }}>
            {siteFixes.length ? "Site fixes · help agents find, read and use your site" : "Your site"}
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
            {siteFixes.map((f, i) => (
              <div key={f.kind} style={{ padding: "12px 14px", borderTop: i ? "1px solid var(--border)" : "none", opacity: siteOn[f.kind] ? 1 : 0.6 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  {/* The SDK is what feeds every console page, so it always ships. */}
                  <input
                    type="checkbox"
                    checked={f.kind === "sdk" || !!siteOn[f.kind]}
                    disabled={f.kind === "sdk"}
                    onChange={(e) => setSiteOn((c) => ({ ...c, [f.kind]: e.target.checked }))}
                    aria-label={f.kind === "sdk" ? `${f.title} (always included)` : `Include ${f.title}`}
                    style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--brand-solid)" }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>
                      {f.title}
                      {f.kind === "sdk" && (
                        <span className="ag-muted" style={{ fontWeight: 600, fontSize: 12, marginLeft: 8 }}>
                          Always included: it powers Detect, Auth, Authz, WebMCP Tools, Memory, Observability and Analytics
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 13.5, marginTop: 4 }}>{f.plan}</div>
                    <div className="ag-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                      Today: {f.found} · <span className="ag-mono">{f.files.join(", ")}</span>
                    </div>
                    <details style={{ marginTop: 6 }}>
                      <summary className="ag-muted" style={{ fontSize: 12, cursor: "pointer" }}>Preview</summary>
                      <pre style={{ margin: "6px 0 0", background: "var(--code-bg)", color: "var(--code-fg)", borderRadius: "var(--radius-md)", padding: "8px 10px", fontSize: 12, overflowX: "auto", whiteSpace: "pre-wrap" }}>
                        {f.preview}
                      </pre>
                    </details>
                  </div>
                </div>
              </div>
            ))}
            <label style={{ display: "block", padding: "12px 14px", borderTop: siteFixes.length ? "1px solid var(--border)" : "none" }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Your site&apos;s address</span>
              <input
                ref={urlRef}
                className="ag-input"
                type="url"
                inputMode="url"
                placeholder="https://yourcompany.com"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                aria-invalid={urlNeeded}
                style={{ maxWidth: 420, ...(urlNeeded ? { borderColor: "var(--danger)", boxShadow: urlTried ? "0 0 0 3px var(--danger-bg)" : undefined } : {}) }}
              />
              <span className={urlNeeded ? undefined : "ag-muted"} style={{ display: "block", fontSize: 12, marginTop: 4, ...(urlNeeded ? { color: "var(--danger)" } : {}) }}>
                {urlNeeded
                  ? "Needed: Agent Nic creates your Agentronics SDK key for this address (the sitemap and structured data use it too)."
                  : `${detectedUrl ? `From ${detectedSource ?? "your repo"}. ` : ""}Your Agentronics SDK key is made for this address; the sitemap and structured data use it too.`}
              </span>
            </label>
          </div>
        </section>

      {tools.length > 0 && (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>
          {approved} of {tools.length} tools selected
          {max !== null && <span className="ag-muted" style={{ fontWeight: 600 }}> · {plan.name} includes {max} per site</span>}
        </strong>
        <button className="ag-btn ag-btn-sm" onClick={() => all(true)} disabled={pending}>
          Select all
        </button>
        <button className="ag-btn ag-btn-sm" onClick={() => all(false)} disabled={pending}>
          Clear
        </button>
      </div>
      )}

      {byPage.map(([page, list]) => (
        <section key={page}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--content-muted)", marginBottom: 6 }}>
            {page === "*" ? "Every page" : `Page ${page}`}
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
            {list.map((t, i) => {
              const c = choice[t.id] ?? { approved: false, auth: t.auth };
              const locked = !allowed(t);
              const risk = RISK[t.risk] ?? { label: t.risk, kind: "info" };
              return (
                <div key={t.id} style={{ padding: "12px 14px", borderTop: i ? "1px solid var(--border)" : "none", opacity: c.approved ? 1 : 0.6 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <input
                      type="checkbox"
                      checked={c.approved && !locked}
                      disabled={locked}
                      onChange={(e) => set(t.id, { approved: e.target.checked })}
                      aria-label={`Include ${t.name}`}
                      style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--brand-solid)" }}
                    />
                    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="ag-mono" style={{ fontWeight: 700 }}>{t.name}</span>
                        <span className="ag-muted" style={{ fontSize: 12 }}>{HOW[t.strategy] ?? t.kind}</span>
                        <Badge kind={risk.kind}>{risk.label}</Badge>
                        {locked && (
                          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--brand-solid)", border: "1px solid var(--brand)", borderRadius: 999, padding: "1px 8px" }}>
                            {plan.unlockedBy[t.strategy] ? `${plan.unlockedBy[t.strategy]} plan` : "Upgrade"}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13.5, marginTop: 4 }}>{t.description}</div>
                      {t.rationale && <div className="ag-muted" style={{ fontSize: 12.5, marginTop: 2 }}>Why: {t.rationale}</div>}
                      <details style={{ marginTop: 6 }}>
                        <summary className="ag-muted" style={{ fontSize: 12, cursor: "pointer" }}>Inputs</summary>
                        <pre style={{ margin: "6px 0 0", background: "var(--code-bg)", color: "var(--code-fg)", borderRadius: "var(--radius-md)", padding: "8px 10px", fontSize: 12, overflowX: "auto" }}>
                          {JSON.stringify(t.inputSchema, null, 2)}
                        </pre>
                      </details>
                    </div>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--content-muted)" }}>
                      Who may use it
                      <select className="ag-select" value={c.auth} onChange={(e) => set(t.id, { auth: e.target.value as Auth })} disabled={!c.approved || locked}>
                        {(Object.keys(AUTH_LABEL) as Auth[]).map((a) => (
                          <option key={a} value={a}>
                            {AUTH_LABEL[a]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{error}</p>}
      {urlNeeded && urlTried && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>Add your site&apos;s address above: Agent Nic creates your SDK key for it.</p>}
      {overLimit && (
        <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>
          {plan.name} includes up to {max} tools per site — deselect {approved - (max ?? 0)} or upgrade.
        </p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {approveButton}
        <button className="ag-btn" onClick={cancel} disabled={pending}>
          Cancel run
        </button>
      </div>

      {needsUpgrade && (
        <section style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Want every tool?</div>
          <p className="ag-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
            {lockedCount ? `${lockedCount} tool${lockedCount === 1 ? " needs" : "s need"} a higher plan. ` : ""}Upgrade and come back to this review — nothing is lost.
          </p>
          <PlanChooser plans={plans} current={plan.id} next={`/agent-nic/runs/${runId}`} billingReady={billingReady} compact />
        </section>
      )}
    </div>
  );
}
