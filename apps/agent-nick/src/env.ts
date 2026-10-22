import { z } from "zod";

const bool = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((v) => v === "true");

const envSchema = z.object({
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.string().default("info"),
  DATABASE_URL: z.string().min(1),
  // Clerk session tokens from the console (same issuer/JWKS as intel-api).
  CLERK_ISSUER: z.string().url(),
  CLERK_JWKS_URL: z.string().url(),

  // GitHub App (Agent Nick). The private key is the PEM GitHub generates;
  // newlines may be escaped as \n when stored in a single-line secret.
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(1).transform((v) => v.replace(/\\n/g, "\n")),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  GITHUB_API_URL: z.string().url().default("https://api.github.com"),

  // Gemini on Vertex AI (Model Garden). Auth is the service account (ADC) on
  // Cloud Run, or GOOGLE_GENAI_SA_KEY (SA JSON) elsewhere — never an API key.
  GCP_PROJECT: z.string().min(1),
  GCP_REGION: z.string().default("asia-south1"),
  VERTEX_LOCATION: z.string().default("global"),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GOOGLE_GENAI_SA_KEY: z.string().optional(),
  // Local dev only: a short-lived OAuth token (`gcloud auth print-access-token`).
  GOOGLE_ACCESS_TOKEN: z.string().optional(),
  // USD per 1M tokens, for the cost shown on each run.
  GEMINI_PRICE_IN: z.coerce.number().default(0.75),
  GEMINI_PRICE_OUT: z.coerce.number().default(3.75),

  // inline: run the graph inside this process (dev, or Cloud Run with CPU always on).
  // job: start a Cloud Run Job execution per run step (same image, `job` command).
  EXECUTOR: z.enum(["inline", "job"]).default("inline"),
  JOB_NAME: z.string().default("agent-nick-job"),

  // Reviews may only be approved when the workspace has an active paid plan.
  REQUIRE_PLAN: bool("true"),
  // Do everything except write to GitHub (branch/commit/PR) — for local testing.
  DRY_RUN: bool("false"),
  // DRY_RUN only: read repos with this token ("" = anonymous, public repos)
  // instead of the GitHub App, to try the pipeline before the App exists.
  GITHUB_DEV_TOKEN: z.string().optional(),
  // Console base URL, linked from PR descriptions.
  CONSOLE_URL: z.string().url().optional(),
  // Local dev only: accept "dev-tenant:<uuid>" bearer tokens from a console
  // running without Clerk. Refused when NODE_ENV=production.
  DEV_AUTH: bool("false"),
  NODE_ENV: z.string().default("development")
}).refine((e) => !(e.DEV_AUTH && e.NODE_ENV === "production"), { message: "DEV_AUTH must never be enabled in production", path: ["DEV_AUTH"] });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) throw new Error(`invalid environment: ${parsed.error.message}`);
  return parsed.data;
}
