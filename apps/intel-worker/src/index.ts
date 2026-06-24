import { createDb } from "@agentronics/intel-schema/db";
import { defaultAdapters } from "./connectors/registry.ts";
import { loadEnv } from "./env.ts";
import { GcpSecretReader } from "./lib/secrets.ts";
import { GcsStorage } from "./lib/storage.ts";
import { GcpMlTrigger } from "./mlTrigger.ts";
import { initTracing } from "./otel.ts";
import { buildServer } from "./server.ts";

const env = loadEnv();
void initTracing("intel-worker");

const app = buildServer({
  db: createDb(env.DATABASE_URL),
  storage: new GcsStorage(env.GCS_BUCKET),
  secrets: new GcpSecretReader(env.GCP_PROJECT),
  ml: new GcpMlTrigger(env),
  adapters: defaultAdapters,
  retentionDays: env.RETENTION_DAYS
});

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err, "failed to start intel-worker");
  process.exit(1);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, async () => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  });
}
