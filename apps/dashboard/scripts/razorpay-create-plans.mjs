#!/usr/bin/env node
// Create the 4 Razorpay plans (Pro/Business × monthly/yearly, USD only) and
// print the env vars the console needs. Run ONCE per Razorpay mode (test, then
// live) — Razorpay plans can't be edited, only replaced.
//
//   RAZORPAY_KEY_ID=rzp_test_… RAZORPAY_KEY_SECRET=… node scripts/razorpay-create-plans.mjs
//
// USD plans need International Payments enabled on the Razorpay account.
// Pricing is USD only.
// Prices mirror lib/billing/plans.ts — keep them in sync.

const PRICES = {
  pro: { name: "Pro", monthly: 25, yearly: 250 },
  business: { name: "Business", monthly: 99, yearly: 990 }
};

const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (test keys first).");
  process.exit(1);
}
const auth = "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
const mode = id.startsWith("rzp_live_") ? "LIVE" : "TEST";
console.error(`Creating plans in Razorpay ${mode} mode…\n`);

const lines = [];
const currency = "USD";
for (const [tier, p] of Object.entries(PRICES)) {
  for (const cycle of ["monthly", "yearly"]) {
    const amount = p[cycle] * 100; // cents
    const res = await fetch("https://api.razorpay.com/v1/plans", {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({
        period: cycle,
        interval: 1,
        item: {
          name: `Agentronics ${p.name} (${cycle})`,
          amount,
          currency,
          description: `Agentronics ${p.name} — authentication for AI agents`
        },
        notes: { tier, cycle, currency }
      })
    });
    const body = await res.json();
    const key = `RAZORPAY_PLAN_${tier.toUpperCase()}_${cycle.toUpperCase()}_${currency}`;
    if (!res.ok) {
      console.error(`✘ ${key}: ${body?.error?.description ?? res.status}`);
      continue;
    }
    console.error(`✔ ${key} = ${body.id}`);
    lines.push(`${key}=${body.id}`);
  }
}
console.error("\nAdd these to the console's environment (Vercel → dashboard project):\n");
console.log(lines.join("\n"));
