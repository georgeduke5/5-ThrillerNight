import "server-only";
import type { NextRequest } from "next/server";

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Max hits allowed within windowMs before isRateLimited() reports blocked. */
  max: number;
  windowMs: number;
}

/**
 * Minimal in-memory fixed-window rate limiter. Deliberately not backed by
 * Redis/Upstash/Vercel KV — this is a single small private event with low
 * concurrency, and adding a paid or third-party-hosted dependency for it
 * isn't worth the setup burden. Known limitation, accepted for this scale:
 * state lives in the Node process's memory, so it resets on every
 * serverless cold start and isn't shared across concurrent instances on
 * Vercel — a determined attacker spreading requests across cold starts can
 * partially evade it. It still meaningfully raises the bar over no limiting
 * at all for the common case (a single instance handling a burst of
 * attempts), which is the actual threat model here.
 */
export function isRateLimited(key: string, { max, windowMs }: RateLimitOptions): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  if (Date.now() - bucket.windowStart > windowMs) {
    buckets.delete(key);
    return false;
  }
  return bucket.count >= max;
}

/** Records one hit against key, starting a fresh window if the previous one expired or none exists. */
export function recordHit(key: string, { windowMs }: RateLimitOptions): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }
  bucket.count += 1;
}

/** Clears any recorded hits for key — e.g. on a successful login, so a correct password never gets blocked by earlier failures. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Best-effort client IP from the headers Vercel's proxy sets. Falls back to a shared "unknown" bucket if absent (e.g. local dev). */
export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
