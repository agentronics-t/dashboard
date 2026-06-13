// Raw-row envelope and the normalized event model.
//
// Raw Parquet keeps the source-native payload untouched (JSON) plus this
// envelope, so any pipeline stage can be replayed from raw/ alone.
// The normalized row is the contract documented in docs/SCHEMA_MAPPING.md —
// the ML job reads raw/, applies the mapping, and writes derived/ rows in
// exactly this shape.

import { z } from "zod";
import { connectorSource } from "./enums.ts";

export const RAW_SCHEMA_VERSION = 1;

export const rawEnvelope = z.object({
  ingested_at: z.coerce.date(),
  job_id: z.string().min(1),
  source: connectorSource,
  schema_version: z.number().int().positive(),
  /** Source-native record, JSON-serialized verbatim. */
  payload: z.string()
});
export type RawEnvelope = z.infer<typeof rawEnvelope>;

export const agentLane = z.enum(["webmcp", "webbotauth", "stealth"]);
export type AgentLane = z.infer<typeof agentLane>;

/** Normalized daily aggregate — mirrors the `agent_traffic_daily` Neon table. */
export const agentTrafficDailyRow = z.object({
  tenant_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: connectorSource,
  agent_name: z.string().min(1),
  agent_lane: agentLane,
  requests: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  allowed: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  conversions: z.number().int().nonnegative().default(0),
  job_id: z.string().min(1)
});
export type AgentTrafficDailyRow = z.infer<typeof agentTrafficDailyRow>;
