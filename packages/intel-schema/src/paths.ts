// Canonical GCS object layout. These builders are the single source of path
// truth for every pipeline stage — never hand-build a GCS key elsewhere.
//
//   raw/{source}/{tenant_id}/dt={YYYY-MM-DD}/job={job_id}/part-{n}.parquet   (immutable)
//   derived/{tenant_id}/agent_traffic_daily/dt={YYYY-MM-DD}/part-{n}.parquet (source of truth)
//   models/{tenant_id}/{metric}/{model_version}/model.pkl + metadata.json

import { z } from "zod";
import { connectorSource, type ConnectorSource } from "./enums.ts";

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const partFile = (n: number) => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid part number: ${n}`);
  return `part-${String(n).padStart(5, "0")}.parquet`;
};

export function rawPath(opts: {
  source: ConnectorSource;
  tenantId: string;
  dt: string;
  jobId: string;
  part?: number;
}): string {
  connectorSource.parse(opts.source);
  isoDate.parse(opts.dt);
  return [
    "raw",
    opts.source,
    opts.tenantId,
    `dt=${opts.dt}`,
    `job=${opts.jobId}`,
    partFile(opts.part ?? 0)
  ].join("/");
}

export function derivedPath(opts: {
  tenantId: string;
  dataset?: string;
  dt: string;
  part?: number;
}): string {
  isoDate.parse(opts.dt);
  return [
    "derived",
    opts.tenantId,
    opts.dataset ?? "agent_traffic_daily",
    `dt=${opts.dt}`,
    partFile(opts.part ?? 0)
  ].join("/");
}

export function modelPath(opts: {
  tenantId: string;
  metric: string;
  modelVersion: string;
  file?: "model.pkl" | "metadata.json";
}): string {
  return [
    "models",
    opts.tenantId,
    opts.metric,
    opts.modelVersion,
    opts.file ?? "model.pkl"
  ].join("/");
}

/** Prefix for all raw objects of one job — used for replay + idempotency checks. */
export function rawJobPrefix(opts: {
  source: ConnectorSource;
  tenantId: string;
  dt: string;
  jobId: string;
}): string {
  connectorSource.parse(opts.source);
  isoDate.parse(opts.dt);
  return ["raw", opts.source, opts.tenantId, `dt=${opts.dt}`, `job=${opts.jobId}`].join("/") + "/";
}
