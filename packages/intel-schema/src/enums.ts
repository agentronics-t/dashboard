import { z } from "zod";

/** Connector sources supported by the import worker. */
export const connectorSource = z.enum(["cloudflare", "profound", "scrunch"]);
export type ConnectorSource = z.infer<typeof connectorSource>;

/** Pipeline job types. */
export const jobType = z.enum(["import", "ml", "insight"]);
export type JobType = z.infer<typeof jobType>;

/** Job status state machine: queued → running → succeeded | failed. */
export const jobStatus = z.enum(["queued", "running", "succeeded", "failed"]);
export type JobStatus = z.infer<typeof jobStatus>;
