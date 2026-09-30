"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TIERS, formatPrice, type Currency, type Cycle, type PaidTier, type Tier } from "@/lib/billing/plans";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void; on(event: string, cb: (e: unknown) => void): void };
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const s = existing ?? document.createElement("script");
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () => reject(new Error("Could not load Razorpay Checkout")));
    if (!existing) {
      s.src = CHECKOUT_SRC;
      s.async = true;
      document.head.appendChild(s);
    }
  });
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(MESSAGES[json.error as string] ?? json.message ?? "Something went wrong");
  return json as T;
}

const MESSAGES: Record<string, string> = {
  billing_not_configured: "Billing isn't configured on this deployment yet.",
  auth_not_configured: "Sign-in isn't configured on this deployment.",
  billing_admin_only: "Only organization admins can change the plan.",
  already_subscribed: "You already have an active plan. Cancel it before switching.",
  plan_not_configured: "This plan isn't available in this currency yet.",
  invalid_signature: "We couldn't verify the payment. You haven't been charged twice — contact support."
};

const seg = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px",
  borderRadius: 999,
  border: "none",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  background: active ? "var(--content)" : "transparent",
  color: active ? "var(--surface)" : "var(--content-secondary)"
});

const segWrap: React.CSSProperties = {
  display: "inline-flex",
  gap: 2,
  padding: 3,
  borderRadius: 999,
  border: "1px solid var(--border)",
  background: "var(--surface)"
};

export function PlanPicker({
  current,
  enabled,
  initial
}: {
  current: Tier;
  enabled: boolean;
  initial: { plan: PaidTier | null; cycle: Cycle; currency: Currency };
}) {
  const router = useRouter();
  const [cycle, setCycle] = useState<Cycle>(initial.cycle);
  const [currency, setCurrency] = useState<Currency>(initial.currency);
  const [busy, setBusy] = useState<PaidTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upgrade(plan: PaidTier) {
    setError(null);
    setBusy(plan);
    try {
      const co = await post<{ subscriptionId: string; keyId: string; planName: string }>("/api/billing/subscribe", {
        plan,
        cycle,
        currency
      });
      await loadCheckout();
      const rzp = new window.Razorpay!({
        key: co.keyId,
        subscription_id: co.subscriptionId,
        name: "Agentronics",
        description: `${co.planName} plan · ${cycle}`,
        theme: { color: "#5b4fd1" },
        handler: async (resp: Record<string, string>) => {
          try {
            await post("/api/billing/verify", resp);
            setDone(`You're on ${co.planName}. Thank you!`);
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(null);
          }
        },
        modal: { ondismiss: () => setBusy(null) }
      });
      rzp.on("payment.failed", () => {
        setError("The payment didn't go through. You can try again with another method.");
        setBusy(null);
      });
      rzp.open();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const tiles: Tier[] = ["free", "pro", "business", "enterprise"];

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={segWrap} role="group" aria-label="Billing cycle">
          <button type="button" style={seg(cycle === "monthly")} onClick={() => setCycle("monthly")}>Monthly</button>
          <button type="button" style={seg(cycle === "yearly")} onClick={() => setCycle("yearly")}>Yearly · 16% off</button>
        </div>
        <div style={segWrap} role="group" aria-label="Currency">
          <button type="button" style={seg(currency === "USD")} onClick={() => setCurrency("USD")}>USD</button>
          <button type="button" style={seg(currency === "INR")} onClick={() => setCurrency("INR")}>INR</button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 14, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--danger-bg)", color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}
      {done && (
        <div role="status" style={{ marginBottom: 14, padding: "10px 12px", borderRadius: "var(--radius-md)", background: "var(--success-bg)", color: "var(--success)", fontSize: 13 }}>
          {done}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {tiles.map((t) => {
          const info = TIERS[t];
          const isCurrent = t === current;
          const suggested = initial.plan === t && !isCurrent;
          const price = info.prices ? formatPrice(info.prices[currency][cycle], currency) : t === "free" ? formatPrice(0, currency) : "Custom";
          return (
            <div
              key={t}
              style={{
                padding: 16,
                borderRadius: "var(--radius-lg, 12px)",
                border: `1px solid ${suggested ? "var(--brand-solid)" : "var(--border)"}`,
                background: "var(--surface)",
                display: "flex",
                flexDirection: "column",
                gap: 6
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700 }}>{info.name}</span>
                {isCurrent && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-solid)" }}>CURRENT</span>}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>
                {price}
                {info.prices && <span style={{ fontSize: 13, fontWeight: 500, color: "var(--content-muted)" }}>/{cycle === "yearly" ? "yr" : "mo"}</span>}
              </div>
              <div style={{ fontSize: 13, color: "var(--content-secondary)" }}>
                {info.maa ? `${info.maa.toLocaleString("en-US")} monthly active agents` : "Custom volume"}
              </div>
              <div style={{ marginTop: "auto", paddingTop: 8 }}>
                {t === "pro" || t === "business" ? (
                  <button
                    type="button"
                    disabled={!enabled || isCurrent || current !== "free" || busy !== null}
                    onClick={() => upgrade(t)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: "var(--radius-md)",
                      border: "none",
                      background: "var(--brand-solid)",
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: "pointer",
                      opacity: !enabled || isCurrent || current !== "free" || busy !== null ? 0.5 : 1
                    }}
                  >
                    {busy === t ? "Opening checkout…" : isCurrent ? "Current plan" : `Upgrade to ${info.name}`}
                  </button>
                ) : t === "enterprise" ? (
                  <a
                    href="https://agentronics.dev/book"
                    style={{ display: "block", textAlign: "center", padding: "8px 12px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", color: "var(--content)", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
                  >
                    Contact sales
                  </a>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {!enabled && (
        <p style={{ marginTop: 12, fontSize: 13, color: "var(--content-muted)" }}>
          Checkout is unavailable on this deployment (Razorpay keys or sign-in not configured).
        </p>
      )}
    </div>
  );
}

export function CancelPlanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("Cancel your plan at the end of the current billing period?")) return;
          setBusy(true);
          setError(null);
          try {
            await post("/api/billing/cancel", {});
            router.refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        style={{ padding: "7px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "transparent", color: "var(--content)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
      >
        {busy ? "Cancelling…" : "Cancel plan"}
      </button>
      {error && <span style={{ fontSize: 12, color: "var(--danger)" }}>{error}</span>}
    </span>
  );
}
