// SDK event ingest contract. A local zod v4 mirror of @agentronics/protocol's
// TraceEvent / TraceBatch — we don't depend on the SDK package because it pins
// zod v3 and mixing zod-major schema instances is unsafe. Keep TRACE_EVENT_TYPES
// in sync with the SDK's TraceEventType and the `sdk_event_type` pg enum in
// db/schema.ts.

import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";

// Per-tenant SDK ingest keys. Format: agtx_ik_<base64url>. Only the SHA-256
// hash is persisted; the raw key is shown once at creation. Shared here so both
// intel-api (auth) and the dashboard (key minting server action) use one impl.
export const SDK_INGEST_KEY_PREFIX = "agtx_ik_";

export function generateIngestKey(): { raw: string; hash: string; prefix: string } {
  const raw = SDK_INGEST_KEY_PREFIX + randomBytes(24).toString("base64url");
  return { raw, hash: hashIngestKey(raw), prefix: raw.slice(0, 16) };
}

export function hashIngestKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function isIngestKey(token: string): boolean {
  return token.startsWith(SDK_INGEST_KEY_PREFIX);
}

// Browser-safe publishable keys for the SDK's public API (/v1/pub/*).
export const SDK_PUBLISHABLE_KEY_PREFIX = "agtx_pk_";

export function generatePublishableKey(): string {
  return SDK_PUBLISHABLE_KEY_PREFIX + "live_" + randomBytes(18).toString("base64url");
}

export function isPublishableKey(token: string): boolean {
  return token.startsWith(SDK_PUBLISHABLE_KEY_PREFIX);
}

/** "https://Shop.example/" → "https://shop.example"; null if it isn't an http(s) origin. */
export function normaliseOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export const TRACE_EVENT_TYPES = [
  "agent.detected",
  "agent.missed",
  "auth.identity_presented",
  "auth.identity_cleared",
  "authz.policies_set",
  "authz.evaluated",
  "memory.accessed",
  "memory.updated",
  "tool.registered",
  "tool.executed",
  "tool.surfaced",
  "tool.progressed",
  "sdk.error"
] as const;

export const sdkEventType = z.enum(TRACE_EVENT_TYPES);
export type SdkEventType = z.infer<typeof sdkEventType>;

export const sdkEventOutcome = z.enum(["success", "error", "blocked"]);
export type SdkEventOutcome = z.infer<typeof sdkEventOutcome>;

export const sdkAgentClass = z.enum(["webmcp", "dom", "screenshot", "crawler"]);
export type SdkAgentClass = z.infer<typeof sdkAgentClass>;

export const sdkAgentIdentity = z.object({
  class: sdkAgentClass,
  trust: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  vendor: z.string().nullable().optional(),
  userAgent: z.string().nullable().optional(),
  detectionVersion: z.string().optional(),
  signals: z.record(z.string(), z.unknown()).optional()
});
export type SdkAgentIdentity = z.infer<typeof sdkAgentIdentity>;

export const sdkTraceEvent = z.object({
  id: z.string().min(1),
  siteId: z.string().min(1),
  sessionId: z.string().min(1),
  // ISO string; coerced to a Date at ingest.
  occurredAt: z.string().min(1),
  type: sdkEventType,
  tool: z.string().optional(),
  agent: sdkAgentIdentity.nullable().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  outcome: sdkEventOutcome,
  error: z.string().optional(),
  // Reserved metadata keys the ingest reads: `page`, `protocol`.
  metadata: z.record(z.string(), z.unknown()).default({})
});
export type SdkTraceEvent = z.infer<typeof sdkTraceEvent>;

export const sdkTraceBatch = z.object({
  // Present on browser-SDK batches; never trusted for auth (the ingest key is).
  publishableKey: z.string().optional(),
  events: z.array(sdkTraceEvent).min(1).max(500)
});
export type SdkTraceBatch = z.infer<typeof sdkTraceBatch>;

// Authoritative pushes for the WebMCP Tools + Knaph pages. The full tool
// descriptors (schema + token cost) and the site-memory snapshot are too large
// for lightweight trace events, so they get dedicated endpoints
// (POST /v1/sdk/tools, POST /v1/sdk/memory). Mirrors the SDK's syncTools()
// registry + provideSiteMemory() snapshot.
export const sdkToolDescriptor = z.object({
  name: z.string().min(1),
  title: z.string().max(200).optional(),
  description: z.string().max(8000).optional(),
  annotations: z.record(z.string(), z.boolean()).optional(),
  group: z.string().nullable().optional(),
  page: z.string().nullable().optional(),
  inputSchema: z.record(z.string(), z.unknown()).optional(),
  outputSchema: z.record(z.string(), z.unknown()).nullable().optional(),
  tokens: z.number().int().nonnegative().optional()
});
export type SdkToolDescriptor = z.infer<typeof sdkToolDescriptor>;

export const sdkToolsPush = z.object({
  siteId: z.string().min(1),
  tools: z.array(sdkToolDescriptor).max(1000)
});
export type SdkToolsPush = z.infer<typeof sdkToolsPush>;

export const sdkMemoryPush = z.object({
  siteId: z.string().min(1),
  snapshot: z.record(z.string(), z.unknown()),
  score: z.number().int().min(0).max(100).nullable().optional()
});
export type SdkMemoryPush = z.infer<typeof sdkMemoryPush>;

// ---- console-managed config the SDK pulls (POST /v1/sdk/config) -------------
export const POLICY_DECISIONS = ["allow", "deny", "review"] as const;
export const TRUST_LEVELS = ["detected", "declared", "verified", "linked"] as const;
export const AGENT_CLASSES = ["webmcp", "dom", "screenshot", "crawler"] as const;

/** One authorization rule, shaped like @agentronics/protocol PolicyRule. */
export const sdkPolicyRule = z.object({
  id: z.string(),
  tool: z.string().min(1).max(200),
  decision: z.enum(POLICY_DECISIONS),
  minTrust: z.enum(TRUST_LEVELS),
  allowedClasses: z.array(z.enum(AGENT_CLASSES)).default([]),
  rateLimit: z
    .object({ max: z.number().int().positive(), windowSeconds: z.number().int().positive() })
    .optional()
});
export type SdkPolicyRule = z.infer<typeof sdkPolicyRule>;

export const sdkConfigRequest = z.object({ siteId: z.string().min(1) });
export const sdkAgentKeyVerify = z.object({ key: z.string().min(8).max(200) });

/** A rule as edited in the console's Authz page. siteId "*" = every site. */
export const sdkPolicyInput = z.object({
  id: z.string().uuid().optional(),
  siteId: z.string().trim().min(1).max(120).default("*"),
  tool: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_.:*-]+$/, "Tool names use letters, numbers, _ . : - and * as a wildcard."),
  decision: z.enum(POLICY_DECISIONS),
  minTrust: z.enum(TRUST_LEVELS),
  allowedClasses: z.array(z.enum(AGENT_CLASSES)).default([]),
  rateLimit: z
    .object({ max: z.number().int().positive().max(100_000), windowSeconds: z.number().int().positive().max(86_400) })
    .nullable()
    .default(null)
});
export type SdkPolicyInput = z.input<typeof sdkPolicyInput>;
