import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  CLERK_ISSUER: z.string().url(),
  CLERK_JWKS_URL: z.string().url(),
  GCP_PROJECT: z.string().min(1),
  GCP_REGION: z.string().default("asia-south1"),
  TASKS_QUEUE: z.string().default("import-jobs"),
  WORKER_URL: z.string().url(),
  TASKS_OIDC_SERVICE_ACCOUNT: z.string().email(),
  // STEP 8 — Cloud Scheduler service-to-service auth (both required to enable)
  SCHEDULER_SA: z.string().email().optional(),
  API_AUDIENCE: z.string().url().optional()
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
