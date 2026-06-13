import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }
  // Neon pooler (pgbouncer) — no prepared statements
  const client = postgres(databaseUrl, { prepare: false, max: 5 });
  return drizzle(client, { schema });
}

export { schema };
