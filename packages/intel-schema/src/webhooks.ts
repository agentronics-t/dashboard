// Webhook export (Pro+): signing and delivery, shared by intel-api (the
// scheduled delivery) and the console ("Send test"). Server-only: it opens
// sockets, so it lives on its own subpath, not in the package root.
//
// Signatures follow Standard Webhooks (standardwebhooks.com), so customers can
// verify with any of its libraries: HMAC-SHA256 over `${id}.${timestamp}.${body}`
// keyed with the base64 part of the whsec_ secret.
import { createHmac, randomBytes } from "node:crypto";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

export const WEBHOOK_SECRET_PREFIX = "whsec_";

export function generateWebhookSecret(): string {
  return WEBHOOK_SECRET_PREFIX + randomBytes(24).toString("base64");
}

/** Headers for one delivery (webhook-id / webhook-timestamp / webhook-signature). */
export function signWebhook(secret: string, id: string, timestampSec: number, body: string): Record<string, string> {
  const key = Buffer.from(secret.slice(WEBHOOK_SECRET_PREFIX.length), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestampSec}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(timestampSec), "webhook-signature": `v1,${sig}` };
}

// Never deliver to our own network: loopback, private ranges, link-local
// (incl. the cloud metadata server), CGNAT, multicast, and v4-in-v6 forms.
const blocked = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]
] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]
] as const) blocked.addSubnet(net, bits, "ipv6");

export function isBlockedAddress(ip: string): boolean {
  // ::ffff:a.b.c.d is IPv4 in disguise; judge it as IPv4. (A ::ffff:0:0/96
  // rule would also match every plain IPv4 address in a BlockList.)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  if (mapped) return isBlockedAddress(mapped);
  const family = isIP(ip);
  return family === 0 || blocked.check(ip, family === 6 ? "ipv6" : "ipv4");
}

/** Why a URL can't be a webhook endpoint, or null if it can. */
export function webhookUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Enter a full URL, like https://example.com/hooks/agentronics.";
  }
  if (u.protocol !== "https:") return "The URL must start with https://.";
  if (u.username || u.password) return "Leave credentials out of the URL; verify the signature instead.";
  if (raw.length > 2000) return "That URL is too long.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return "The URL must be on the public internet.";
  if (isIP(host) && isBlockedAddress(host)) return "The URL must be on the public internet.";
  return null;
}

export interface DeliveryResult {
  ok: boolean;
  /** HTTP status code as text, or what went wrong ("timeout", "blocked address", …). */
  status: string;
}

/**
 * POST a signed JSON body. The address check runs at connect time, on every
 * address the name resolves to, so DNS can't be swapped after validation.
 * Redirects are not followed.
 */
export function postWebhook(url: string, secret: string, id: string, body: string, timeoutMs = 10_000): Promise<DeliveryResult> {
  const problem = webhookUrlProblem(url);
  if (problem) return Promise.resolve({ ok: false, status: "invalid url" });
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isBlockedAddress(host)) return Promise.resolve({ ok: false, status: "blocked address" });

  const headers = {
    "content-type": "application/json",
    "user-agent": "Agentronics-Webhooks/1.0",
    ...signWebhook(secret, id, Math.floor(Date.now() / 1000), body)
  };
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: DeliveryResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const req = request(
      url,
      {
        method: "POST",
        headers,
        timeout: timeoutMs,
        lookup: (hostname, options, cb) => {
          dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
            if (err) return cb(err, "", 4);
            if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
              return cb(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }), "", 4);
            }
            if ((options as { all?: boolean }).all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
            cb(null, addresses[0]!.address, addresses[0]!.family);
          });
        }
      },
      (res) => {
        res.resume(); // drain; we only need the status
        const code = res.statusCode ?? 0;
        done({ ok: code >= 200 && code < 300, status: String(code) });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      done({ ok: false, status: "timeout" });
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      done({ ok: false, status: err.code === "EBLOCKED" ? "blocked address" : err.code === "ENOTFOUND" ? "host not found" : "connection failed" });
    });
    req.end(body);
  });
}
