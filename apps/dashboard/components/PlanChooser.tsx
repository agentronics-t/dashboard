"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { choosePlan, openBillingPortal } from "@/app/(app)/account/billing-actions";

export interface PlanCard {
  id: string;
  name: string;
  price: number | null;
  tagline: string;
  highlights: string[];
}

const SALES_URL = "https://agentronics.dev/book";

/** Plan cards with upgrade buttons; the current plan is marked, Enterprise goes to sales. */
export function PlanChooser({
  plans,
  current,
  next,
  billingReady,
  compact = false
}: {
  plans: PlanCard[];
  current: string;
  next: string;
  billingReady: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const rank = (id: string) => plans.findIndex((p) => p.id === id);

  const pick = (id: string) => {
    setBusy(id);
    setError(null);
    start(async () => {
      const res = await choosePlan(id, next);
      if (!res.ok) {
        setError(res.error);
        setBusy(null);
      } else if (res.url) window.location.assign(res.url);
      else {
        setBusy(null);
        router.refresh();
      }
    });
  };

  return (
    <div>
      <div className="ag-plan-grid">
        {plans.map((p) => {
          const isCurrent = p.id === current;
          const higher = rank(p.id) > rank(current);
          return (
            <div key={p.id} className="ag-plan" data-selected={isCurrent} style={{ cursor: "default", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <strong>{p.name}</strong>
                <span>
                  {p.price === null ? (
                    <strong>Custom</strong>
                  ) : (
                    <>
                      <strong style={{ fontSize: 18 }}>${p.price}</strong>
                      <span className="ag-muted" style={{ fontSize: 12 }}>/mo</span>
                    </>
                  )}
                </span>
              </div>
              <div className="ag-muted" style={{ fontSize: 12.5 }}>{p.tagline}</div>
              {!compact && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, fontSize: 12.5, lineHeight: 1.6 }}>
                  {p.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              )}
              <div style={{ marginTop: "auto", paddingTop: 8 }}>
                {isCurrent ? (
                  <span className="ag-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>Current plan</span>
                ) : p.price === null ? (
                  <a className="ag-btn ag-btn-sm" href={SALES_URL} target="_blank" rel="noreferrer">
                    Contact sales
                  </a>
                ) : p.price === 0 ? null : (
                  <button className={`ag-btn ag-btn-sm${higher ? " ag-btn-primary" : ""}`} disabled={!billingReady || busy !== null} onClick={() => pick(p.id)}>
                    {busy === p.id ? "Opening…" : higher ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!billingReady && <p className="ag-muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Payments aren&apos;t set up on this console yet.</p>}
      {error && <p style={{ color: "var(--danger)", fontSize: 13, margin: "10px 0 0" }}>{error}</p>}
    </div>
  );
}

export function ManageBillingButton() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button
        className="ag-btn ag-btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await openBillingPortal();
            if (res.ok && res.url) window.location.assign(res.url);
            else if (!res.ok) setError(res.error);
          })
        }
      >
        {pending ? "Opening…" : "Invoices & payment method"}
      </button>
      {error && <span style={{ color: "var(--danger)", fontSize: 12.5 }}>{error}</span>}
    </span>
  );
}
