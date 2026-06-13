// Shared HTTP helper for connector adapters: retries 429/5xx with exponential
// backoff (honors Retry-After), fails fast on other 4xx.

export interface RetryOptions {
  retries?: number | undefined;
  baseDelayMs?: number | undefined;
  fetchFn?: typeof fetch | undefined;
  /** test hook — replaces real sleeping */
  sleepFn?: ((ms: number) => Promise<void>) | undefined;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: RetryOptions = {}
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const doFetch = opts.fetchFn ?? fetch;
  const doSleep = opts.sleepFn ?? sleep;

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, init);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) await doSleep(base * 2 ** attempt);
      continue;
    }

    if (res.ok) return res;

    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`HTTP ${res.status} from ${url}`);
      if (attempt < retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : base * 2 ** attempt;
        await doSleep(delay);
      }
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 300)}`);
  }
  throw lastError ?? new Error(`fetch failed: ${url}`);
}
