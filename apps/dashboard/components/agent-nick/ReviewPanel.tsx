"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { cancelRun, startPlanCheckout, submitReview } from "@/app/(app)/agent-nick/actions";
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

interface Plan {
  id: string;
  name: string;
  price: number;
  tools: string;
  blurb: string;
}

const HOW: Record<string, string> = { form: "Form", dom: "On-page action", fetch: "API call", server_action: "Server action" };
const RISK: Record<string, { label: string; kind: string }> = {
  read: { label: "read-only", kind: "succeeded" },
  write: { label: "changes data", kind: "info" },
  payment: { label: "payment", kind: "warning" },
  destructive: { label: "irreversible", kind: "critical" }
};
const AUTH_LABEL: Record<Auth, string> = { public: "Any agent", signed_in: "Signed-in visitors", scoped: "Scoped grant only" };
const LITE_LIMIT = 10;

type Choice = Record<string, { approved: boolean; auth: Auth }>;

export function ReviewPanel({
  runId,
  tools,
  plans,
  activePlan,
  billingReady
}: {
  runId: string;
  tools: ReviewTool[];
  plans: Plan[];
  activePlan: string | null;
  billingReady: boolean;
}) {
  const router = useRouter();
  const draftKey = `agent-nick-review:${runId}`;
  const [choice, setChoice] = useState<Choice>(() => Object.fromEntries(tools.map((t) => [t.id, { approved: true, auth: t.auth }])));
  const [plan, setPlan] = useState<string>(activePlan ?? "starter");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Restore choices made before a trip to the checkout page.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setChoice((c) => ({ ...c, ...(JSON.parse(saved) as Choice) }));
    } catch {
      /* storage unavailable — start fresh */
    }
  }, [draftKey]);

  const byPage = useMemo(() => {
    const m = new Map<string, ReviewTool[]>();
    for (const t of tools) m.set(t.page, [...(m.get(t.page) ?? []), t]);
    return [...m.entries()].sort(([a], [b]) => (a === "*" ? -1 : b === "*" ? 1 : a.localeCompare(b)));
  }, [tools]);

  const approved = tools.filter((t) => choice[t.id]?.approved).length;
  const overLite = activePlan === "lite" && approved > LITE_LIMIT;
  const set = (id: string, patch: Partial<{ approved: boolean; auth: Auth }>) =>
    setChoice((c) => ({ ...c, [id]: { approved: c[id]?.approved ?? true, auth: c[id]?.auth ?? "public", ...patch } }));
  const all = (approvedAll: boolean) => setChoice((c) => Object.fromEntries(Object.entries(c).map(([id, v]) => [id, { ...v, approved: approvedAll }])));

  const approve = () =>
    start(async () => {
      setError(null);
      const res = await submitReview(
        runId,
        tools.map((t) => ({ id: t.id, approved: choice[t.id]?.approved ?? false, auth: choice[t.id]?.auth ?? t.auth }))
      );
      if (!res.ok) return setError(res.error);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      router.refresh();
    });

  const pay = () =>
    start(async () => {
      setError(null);
      try {
        localStorage.setItem(draftKey, JSON.stringify(choice));
      } catch {
        /* ignore — choices just reset after checkout */
      }
      const res = await startPlanCheckout(plan, runId);
      if (!res.ok) return setError(res.error);
      window.location.assign(res.url);
    });

  const cancel = () =>
    start(async () => {
      const res = await cancelRun(runId);
      if (!res.ok) setError(res.error);
      router.refresh();
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>
          {approved} of {tools.length} tools selected
        </strong>
        <button className="ag-btn ag-btn-sm" onClick={() => all(true)} disabled={pending}>
          Select all
        </button>
        <button className="ag-btn ag-btn-sm" onClick={() => all(false)} disabled={pending}>
          Clear
        </button>
      </div>

      {byPage.map(([page, list]) => (
        <section key={page}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--content-muted)", marginBottom: 6 }}>
            {page === "*" ? "Every page" : `Page ${page}`}
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-lg)" }}>
            {list.map((t, i) => {
              const c = choice[t.id] ?? { approved: true, auth: t.auth };
              const risk = RISK[t.risk] ?? { label: t.risk, kind: "info" };
              return (
                <div key={t.id} style={{ padding: "12px 14px", borderTop: i ? "1px solid var(--border)" : "none", opacity: c.approved ? 1 : 0.6 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <input
                      type="checkbox"
                      checked={c.approved}
                      onChange={(e) => set(t.id, { approved: e.target.checked })}
                      aria-label={`Include ${t.name}`}
                      style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--brand-solid)" }}
                    />
                    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="ag-mono" style={{ fontWeight: 700 }}>{t.name}</span>
                        <span className="ag-muted" style={{ fontSize: 12 }}>{HOW[t.strategy] ?? t.kind}</span>
                        <Badge kind={risk.kind}>{risk.label}</Badge>
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
                      <select className="ag-select" value={c.auth} onChange={(e) => set(t.id, { auth: e.target.value as Auth })} disabled={!c.approved}>
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

      <section style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        {activePlan ? (
          <p style={{ margin: "0 0 12px", fontSize: 13.5 }}>
            Plan: <strong>{plans.find((p) => p.id === activePlan)?.name ?? activePlan}</strong> (active)
            {overLite && <span style={{ color: "var(--danger)" }}> · Lite includes up to {LITE_LIMIT} tools — deselect some or upgrade.</span>}
          </p>
        ) : (
          <>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Pick a plan</div>
            <p className="ag-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>
              Agent Nick writes the code once you're on a plan. Billed monthly in USD; cancel any time.
            </p>
            <div className="ag-plan-grid" role="radiogroup" aria-label="Plan">
              {plans.map((p) => (
                <button key={p.id} type="button" className="ag-plan" data-selected={plan === p.id} role="radio" aria-checked={plan === p.id} onClick={() => setPlan(p.id)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong>{p.name}</strong>
                    <span>
                      <strong style={{ fontSize: 18 }}>${p.price}</strong>
                      <span className="ag-muted" style={{ fontSize: 12 }}>/mo</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 6 }}>{p.tools}</div>
                  <div className="ag-muted" style={{ fontSize: 12, marginTop: 2 }}>{p.blurb}</div>
                </button>
              ))}
            </div>
            {!billingReady && <p className="ag-muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Payments aren't set up on this console yet.</p>}
          </>
        )}

        {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: "12px 0 0" }}>{error}</p>}

        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          {activePlan || !billingReady ? (
            <button className="ag-btn ag-btn-primary" onClick={approve} disabled={pending || approved === 0 || overLite}>
              {pending ? "Working…" : `Approve ${approved} tool${approved === 1 ? "" : "s"} & write the code`}
            </button>
          ) : (
            <button className="ag-btn ag-btn-primary" onClick={pay} disabled={pending || approved === 0}>
              {pending ? "Opening checkout…" : `Pay $${plans.find((p) => p.id === plan)?.price ?? ""}/mo & continue`}
            </button>
          )}
          <button className="ag-btn" onClick={cancel} disabled={pending}>
            Cancel run
          </button>
        </div>
      </section>
    </div>
  );
}
