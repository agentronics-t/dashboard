// Minimal Razorpay Subscriptions client (REST + Basic auth) and signature
// checks, per https://razorpay.com/docs/payments/subscriptions/ and
// https://razorpay.com/docs/webhooks/validate-test/. A thin fetch client keeps
// a payment SDK off the dependency tree; everything here is server-only.

import { createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.razorpay.com/v1";

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: string;
  current_start?: number | null;
  current_end?: number | null;
  short_url?: string;
  notes?: Record<string, string>;
}

export class RazorpayError extends Error {
  readonly status: number;
  readonly code: string;
  // explicit fields: the repo runs tests with node strip-types (no parameter properties)
  constructor(status: number, code: string, message?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface RazorpayClient {
  createSubscription(input: {
    plan_id: string;
    total_count: number;
    notes: Record<string, string>;
    expire_by?: number;
  }): Promise<RazorpaySubscription>;
  fetchSubscription(id: string): Promise<RazorpaySubscription>;
  cancelSubscription(id: string, atCycleEnd: boolean): Promise<RazorpaySubscription>;
}

export function razorpayClient(keyId: string, keySecret: string, fetcher: typeof fetch = fetch): RazorpayClient {
  const auth = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetcher(`${API}${path}`, {
      method,
      headers: { authorization: auth, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000)
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; description?: string } };
    if (!res.ok) {
      throw new RazorpayError(res.status, json.error?.code ?? "RAZORPAY_ERROR", json.error?.description ?? `HTTP ${res.status}`);
    }
    return json as T;
  }
  const safeId = (id: string) => {
    if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new RazorpayError(400, "BAD_ID", "invalid subscription id");
    return id;
  };
  return {
    createSubscription: (input) => call("POST", "/subscriptions", { customer_notify: 1, ...input }),
    fetchSubscription: (id) => call("GET", `/subscriptions/${safeId(id)}`),
    cancelSubscription: (id, atCycleEnd) =>
      call("POST", `/subscriptions/${safeId(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 })
  };
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function equalHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Checkout callback signature for subscriptions:
 *   hmac_sha256(razorpay_payment_id + "|" + subscription_id, key_secret)
 * `subscriptionId` MUST be the id we created and stored — never the id the
 * browser sent back — or a caller could replay another subscription's payment.
 */
export function verifyCheckoutSignature(
  keySecret: string,
  paymentId: string,
  subscriptionId: string,
  signature: string
): boolean {
  if (!paymentId || !subscriptionId || !signature) return false;
  return equalHex(hmacHex(keySecret, `${paymentId}|${subscriptionId}`), signature);
}

/**
 * Webhook signature: hex HMAC-SHA256 of the RAW request body with the webhook
 * secret (X-Razorpay-Signature). Verify before parsing — re-serialised JSON
 * would not match byte-for-byte.
 */
export function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  return equalHex(hmacHex(webhookSecret, rawBody), signature);
}
