// SDK event ingest contract. A local zod v4 mirror of @agentronics/protocol's
// TraceEvent / TraceBatch — we don't depend on the SDK package because it pins
// zod v3 and mixing zod-major schema instances is unsafe. Keep TRACE_EVENT_TYPES
// in sync with the SDK's TraceEventType and the `sdk_event_type` pg enum in
// db/schema.ts.

import { z } from "zod";

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
  // Reserved metadata keys the ingest reads: `page`, `protocol`, and (for
  // memory.updated) `snapshot` + `score`, and (for tool.registered) `tool`.
  metadata: z.record(z.string(), z.unknown()).default({})
});
export type SdkTraceEvent = z.infer<typeof sdkTraceEvent>;

export const sdkTraceBatch = z.object({
  // Present on browser-SDK batches; never trusted for auth (the ingest key is).
  publishableKey: z.string().optional(),
  events: z.array(sdkTraceEvent).min(1).max(500)
});
export type SdkTraceBatch = z.infer<typeof sdkTraceBatch>;
