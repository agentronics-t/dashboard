// The publishable key Agent Nic writes into the site, so the SDK reports to the
// console from the first deploy. Publishable keys are public by design (they
// sit in page source); writes are accepted only from the key's allowed
// origins, so the key is limited to the site's own address.

import { and, eq, isNull } from "drizzle-orm";
import { generatePublishableKey } from "@agentronics/intel-schema";
import { schema, type Db } from "@agentronics/intel-schema/db";
import type { SdkInstall } from "./types.ts";

/** https://www.shop.example → [https://www.shop.example, https://shop.example]; the www/apex twin too. */
export function siteOrigins(url: string): string[] {
  const u = new URL(url);
  const twin = u.hostname.startsWith("www.") ? u.hostname.slice(4) : u.hostname.split(".").length === 2 ? `www.${u.hostname}` : null;
  return [u.origin, ...(twin ? [`${u.protocol}//${twin}${u.port ? `:${u.port}` : ""}`] : [])];
}

/** The site's key (one per site, reused across runs), with the site's origins allowed. */
export async function ensureSdkKey(db: Db, tenantId: string, siteUrl: string): Promise<SdkInstall> {
  const host = new URL(siteUrl).hostname;
  const label = `Agent Nic · ${host}`.slice(0, 80);
  const origins = siteOrigins(siteUrl);
  const [existing] = await db
    .select()
    .from(schema.sdkPublishableKeys)
    .where(and(eq(schema.sdkPublishableKeys.tenantId, tenantId), eq(schema.sdkPublishableKeys.label, label), isNull(schema.sdkPublishableKeys.revokedAt)))
    .limit(1);
  if (existing) {
    const have = (existing.allowedOrigins as string[]) ?? [];
    const merged = [...new Set([...have, ...origins])].slice(0, 20);
    if (merged.length !== have.length) await db.update(schema.sdkPublishableKeys).set({ allowedOrigins: merged }).where(eq(schema.sdkPublishableKeys.id, existing.id));
    return { publishableKey: existing.key, siteId: host };
  }
  const key = generatePublishableKey();
  await db.insert(schema.sdkPublishableKeys).values({ tenantId, key, label, allowedOrigins: origins });
  return { publishableKey: key, siteId: host };
}
