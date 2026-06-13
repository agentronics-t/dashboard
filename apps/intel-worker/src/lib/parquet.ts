// Parquet write/read for the raw layer. Raw rows = envelope columns +
// source-native payload as JSON string (replayable; pyarrow-readable).

import parquet from "@dsnp/parquetjs";
import { PassThrough } from "node:stream";
import {
  RAW_SCHEMA_VERSION,
  rawEnvelope,
  type ConnectorSource,
  type RawEnvelope
} from "@agentronics/intel-schema";

const rawParquetSchema = new parquet.ParquetSchema({
  ingested_at: { type: "TIMESTAMP_MILLIS" },
  job_id: { type: "UTF8" },
  source: { type: "UTF8" },
  schema_version: { type: "INT32" },
  payload: { type: "UTF8" }
});

/** Wrap source-native records in the raw envelope. */
export function toRawRows(opts: {
  records: unknown[];
  jobId: string;
  source: ConnectorSource;
  ingestedAt?: Date;
}): RawEnvelope[] {
  const ingested_at = opts.ingestedAt ?? new Date();
  return opts.records.map((record) =>
    rawEnvelope.parse({
      ingested_at,
      job_id: opts.jobId,
      source: opts.source,
      schema_version: RAW_SCHEMA_VERSION,
      payload: JSON.stringify(record)
    })
  );
}

export async function writeRawParquet(rows: RawEnvelope[]): Promise<Buffer> {
  if (rows.length === 0) throw new Error("refusing to write empty parquet file");
  const chunks: Buffer[] = [];
  const sink = new PassThrough();
  sink.on("data", (c: Buffer) => chunks.push(c));
  const writer = await parquet.ParquetWriter.openStream(
    rawParquetSchema,
    // structurally compatible; parquetjs types demand a full fs.WriteStream
    sink as unknown as Parameters<typeof parquet.ParquetWriter.openStream>[1]
  );
  for (const row of rows) {
    await writer.appendRow({ ...row });
  }
  await writer.close();
  return Buffer.concat(chunks);
}

export async function readRawParquet(data: Buffer): Promise<RawEnvelope[]> {
  const reader = await parquet.ParquetReader.openBuffer(data);
  try {
    const cursor = reader.getCursor();
    const rows: RawEnvelope[] = [];
    for (let rec = await cursor.next(); rec; rec = await cursor.next()) {
      rows.push(rawEnvelope.parse(rec));
    }
    return rows;
  } finally {
    await reader.close();
  }
}
