import type { ConnectorSource } from "@agentronics/intel-schema";

/** Inclusive UTC date window, YYYY-MM-DD. */
export interface PullWindow {
  since: string;
  until: string;
}

export interface ConnectorContext {
  /** Non-secret connector config from Neon (zone ids, base_url overrides…). */
  config: Record<string, unknown>;
  /** Credential from Secret Manager. */
  secret: string;
  window: PullWindow;
  /** Injectable for fixture tests. */
  fetchFn?: typeof fetch;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ConnectorAdapter {
  readonly source: ConnectorSource;
  /** Pull source-native records for the window. Raw layer stores them verbatim. */
  pull(ctx: ConnectorContext): Promise<unknown[]>;
}

/** Default incremental window: lookback_days (default 7) ending yesterday UTC. */
export function computeWindow(
  config: Record<string, unknown>,
  opts: { maxDays?: number; now?: Date } = {}
): PullWindow {
  const now = opts.now ?? new Date();
  const lookbackRaw = Number(config.lookback_days ?? 7);
  const maxDays = opts.maxDays ?? 365;
  const lookback = Math.min(
    Number.isFinite(lookbackRaw) && lookbackRaw >= 1 ? Math.floor(lookbackRaw) : 7,
    maxDays
  );
  const day = 24 * 60 * 60 * 1000;
  const until = new Date(now.getTime() - day); // yesterday — full days only
  const since = new Date(until.getTime() - (lookback - 1) * day);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { since: fmt(since), until: fmt(until) };
}
