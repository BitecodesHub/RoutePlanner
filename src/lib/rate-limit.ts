/**
 * In-process sliding-window rate limiter. Suitable for a single-node
 * deployment; swap for a Redis-backed limiter when scaling horizontally.
 */
const buckets = new Map<string, number[]>();

const MAX_TRACKED_KEYS = 10_000;

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  let hits = buckets.get(key)?.filter((t) => t > cutoff) ?? [];

  if (hits.length >= limit) {
    const retryAfterSeconds = Math.ceil((hits[0] + windowMs - now) / 1000);
    buckets.set(key, hits);
    return { allowed: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  hits = [...hits, now];
  buckets.set(key, hits);

  // Opportunistic cleanup so the map cannot grow without bound.
  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [k, v] of buckets) {
      if (v.every((t) => t <= cutoff)) buckets.delete(k);
      if (buckets.size <= MAX_TRACKED_KEYS / 2) break;
    }
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Forgive a key — e.g. clear failed-login counters after a success. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

export function resetRateLimits(): void {
  buckets.clear();
}
