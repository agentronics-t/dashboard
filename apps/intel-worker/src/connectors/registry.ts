import type { ConnectorSource } from "@agentronics/intel-schema";
import { cloudflareAdapter } from "./cloudflare.ts";
import { profoundAdapter } from "./profound.ts";
import { scrunchAdapter } from "./scrunch.ts";
import type { ConnectorAdapter } from "./types.ts";

export type AdapterRegistry = Record<ConnectorSource, ConnectorAdapter>;

export const defaultAdapters: AdapterRegistry = {
  cloudflare: cloudflareAdapter,
  profound: profoundAdapter,
  scrunch: scrunchAdapter
};
