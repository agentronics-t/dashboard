"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { choosePlan, openBillingPortal } from "@/app/(app)/account/billing-actions";

export interface PlanCard {
  id: string;
  name: string;
  /** USD per month when billed monthly; null = custom. */
  price: number | null;
  /** USD per year when billed yearly; null = custom. */
  priceYearly: number | null;
  tagline: string;
  highlights: string[];
}

const SALES_URL = "https://www.agentronics.dev/book";
type Interval = "month" | "year";

/**
 * Plan cards with upgrade buttons and a Monthly / Yearly switch (yearly is 21%
 * off). The current plan and interval are marked; Enterprise goes to sales.
 */
export function PlanChooser({
  plans,
  current,
  currentInterval = "month",
  next,
  billingReady,
  yearlyReady = false,
  compact = false
}: {
  plans: PlanCard[];
  current: string;
  currentInterval?: Interval;
  next: string;
  billingReady: boolean;
  yearlyReady?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [interval, setBillingInterval] = useState<Interval>(yearlyReady ? currentInterval : "month");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const rank = (id: string) => plans.findIndex((p) => p.id === id);

  const pick = (id: string) => {
    setBusy(id);
    setError(null);
    start(async () => {
      const res = await choosePlan(id, interval, next);
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
      {yearlyReady && (
        <div className="ag-interval" role="radiogroup" aria-label="Billing period">
          {(["month", "year"] as const).map((i) => (
            <button key={i} type="button" role="radio" aria-checked={interval === i} className="ag-interval-opt" onClick={() => setBillingInterval(i)}>
              {i === "month" ? "Monthly" : "Yearly"}
              {i === "year" && <span className="ag-interval-save">Save 21%</span>}
            </button>
          ))}
        </div>
      )}
      <div className="ag-plan-grid">
        {plans.map((p) => {
          const isCurrent = p.id === current && (p.price === 0 || p.price === null || currentInterval === interval);
          const higher = rank(p.id) > rank(current);
          const yearly = interval === "year" && p.priceYearly !== null && p.priceYearly > 0;
          const perMonth = yearly ? Math.round(((p.priceYearly as number) / 12) * 100) / 100 : p.price;
          const action = p.id === current ? (interval === "year" ? "Switch to yearly" : "Switch to monthly") : higher ? `Upgrade to ${p.name}` : `Switch to ${p.name}`;
          return (
            <div key={p.id} className="ag-plan" data-selected={isCurrent} style={{ cursor: "default", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <strong>{p.name}</strong>
                <span style={{ textAlign: "right" }}>
                  {perMonth === null ? (
                    <strong>Custom</strong>
                  ) : (
                    <>
                      <strong style={{ fontSize: 18 }}>${perMonth}</strong>
                      <span className="ag-muted" style={{ fontSize: 12 }}>/mo</span>
                      {yearly && (
                        <span className="ag-muted" style={{ display: "block", fontSize: 11.5 }}>
                          ${p.priceYearly} billed yearly
                        </span>
                      )}
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
                  <span className="ag-muted" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    Current plan{p.price ? (currentInterval === "year" ? " · yearly" : " · monthly") : ""}
                  </span>
                ) : p.price === null ? (
                  <a className="ag-btn ag-btn-sm" href={SALES_URL} target="_blank" rel="noreferrer">
                    Contact sales
                  </a>
                ) : p.price === 0 ? null : (
                  <button className={`ag-btn ag-btn-sm${higher ? " ag-btn-primary" : ""}`} disabled={!billingReady || busy !== null} onClick={() => pick(p.id)}>
                    {busy === p.id ? "Opening…" : action}
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
