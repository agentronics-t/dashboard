import { createDb } from "@agentronics/intel-schema/db";
import { clerkVerifier, googleOidcVerifier } from "./auth.ts";
import { loadEnv } from "./env.ts";
import { GcpSecretStore, GcpTaskQueue } from "./gcp.ts";
import { initTracing } from "./otel.ts";
import { buildServer } from "./server.ts";

const env = loadEnv();
// fire-and-forget: CJS bundle has no top-level await; first requests at worst miss spans
void initTracing("intel-api");

const app = buildServer({
  db: createDb(env.DATABASE_URL),
  auth: clerkVerifier({ issuer: env.CLERK_ISSUER, jwksUrl: env.CLERK_JWKS_URL }),
  tasks: new GcpTaskQueue(env),
  secrets: new GcpSecretStore(env.GCP_PROJECT),
  internalAuth:
    env.SCHEDULER_SA && env.API_AUDIENCE
      ? googleOidcVerifier({
          allowedEmail: env.SCHEDULER_SA,
          audience: env.API_AUDIENCE
        })
      : undefined
});

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err, "failed to start intel-api");
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}
