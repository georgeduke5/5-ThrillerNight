import "server-only";

/**
 * Short-lived read cache shared by every SheetTable instance, keyed by tab
 * name. Exists to absorb the redundant reads a single request already makes
 * for the same tab today (proxy.ts's auth check plus the page itself, or a
 * quick page-to-page navigation) — not a source of truth, so the TTL is
 * intentionally short.
 *
 * Known limit: this lives in module-level memory, so it's scoped to one
 * serverless instance/process. A write on one instance invalidates that
 * instance's entry immediately (see invalidate below), but a different
 * instance handling the next request has its own cache and won't see the
 * write until its own entry expires — up to TTL_MS stale.
 */
const TTL_MS = 10_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export interface ReadCacheOptions {
  /**
   * Bypass the cache and any in-flight de-dup, and always read live. Use
   * this for any read that gates a write — duplicate-vote/guess checks,
   * the one-passkey-per-guest check, check-in approval state, and any
   * other read-then-update flow — where acting on up-to-10s-old data
   * could mean overwriting a concurrent change.
   */
  fresh?: boolean;
}

/**
 * Runs `load` through the per-key cache, unless `options.fresh` is set.
 * Concurrent non-fresh callers for the same key share one in-flight
 * `load()` call instead of each making their own request. A failed read is
 * never cached and never shared: its cache entry is dropped so the next
 * caller (fresh or not) retries against the live API.
 */
export async function readThrough<T>(
  key: string,
  options: ReadCacheOptions,
  load: () => Promise<T>,
): Promise<T> {
  if (options.fresh) {
    return load();
  }

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = load().then(
    (value) => {
      cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
      inFlight.delete(key);
      return value;
    },
    (err) => {
      cache.delete(key);
      inFlight.delete(key);
      throw err;
    },
  );

  inFlight.set(key, promise);
  return promise;
}

/** Called after any write (append/update — a "delete" here is just updateRow with a blank row) to `key`'s tab, so the next read on this instance sees it immediately instead of waiting out the TTL. */
export function invalidate(key: string): void {
  cache.delete(key);
}
