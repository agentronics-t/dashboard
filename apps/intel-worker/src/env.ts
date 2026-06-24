import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  GCP_PROJECT: z.string().min(1),
  GCP_REGION: z.string().default("asia-south1"),
  GCS_BUCKET: z.string().min(1),
  ML_JOB_NAME: z.string().default("intel-ml"),
  // Raw sdk_events older than this are pruned by /tasks/prune (rollups kept).
  RETENTION_DAYS: z.coerce.number().int().positive().default(90)
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
