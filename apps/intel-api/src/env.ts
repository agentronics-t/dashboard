import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().default(8080),
    LOG_LEVEL: z.string().default("info"),
    DATABASE_URL: z.string().min(1),
    CLERK_ISSUER: z.string().url(),
    CLERK_JWKS_URL: z.string().url(),
    GCP_PROJECT: z.string().min(1).optional(),
    GCP_REGION: z.string().default("asia-south1"),
    // Cloud Scheduler service-to-service auth (both required to enable)
    SCHEDULER_SA: z.string().email().optional(),
    API_AUDIENCE: z.string().url().optional(),
    // Raw sdk_events older than this are pruned by POST /v1/maintenance/prune.
    RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
    // Retired intelligence platform (connectors/imports/jobs). Off by default;
    // when on, the Cloud Tasks settings below become required.
    ENABLE_INTELLIGENCE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    TASKS_QUEUE: z.string().default("import-jobs"),
    WORKER_URL: z.string().url().optional(),
    TASKS_OIDC_SERVICE_ACCOUNT: z.string().email().optional()
  })
  .superRefine((env, ctx) => {
    if (!env.ENABLE_INTELLIGENCE) return;
    for (const key of ["GCP_PROJECT", "WORKER_URL", "TASKS_OIDC_SERVICE_ACCOUNT"] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: "custom", path: [key], message: "required when ENABLE_INTELLIGENCE=true" });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.message}`);
  }
  return parsed.data;
}
