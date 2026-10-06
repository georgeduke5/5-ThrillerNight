import "server-only";

/**
 * In-memory logout revocation for voter-session tokens — the one exception
 * to this app's otherwise fully stateless, self-contained signed-cookie
 * sessions (see voterSession.ts). A signed cookie has no server-side record
 * to delete on logout, so without this, clearing the cookie only stops the
 * *browser* from sending the token back; a copy of the raw cookie value
 * taken before logout (stolen device, synced browser history, etc.) would
 * otherwise keep working until its 12-hour expiry.
 *
 * Same accepted trade-off as rateLimit.ts: no Redis/KV dependency for a
 * single small private event, at the cost of resetting on a cold start and
 * not being shared across concurrent instances. Worst case on a reset, a
 * pre-logout token starts working again — no worse than if this module
 * didn't exist at all, and it still closes the gap for the common case
 * (one running instance, a guest or admin logging out on their own device).
 *
 * An epoch counter, not a revoked-at timestamp: comparing wall-clock times
 * risks a token minted in the same millisecond as its own guest's logout
 * call being misjudged either way. Ordering two in-process calls against
 * each other instead (revoke bumps the counter; mint reads whatever the
 * counter currently is) has no such race — a token minted after a logout
 * call always observes the bumped value, never the stale one.
 */
const epochByGuestId = new Map<string, number>();

/** The epoch a freshly-minted session for guestId should be stamped with. */
export function currentSessionEpoch(guestId: string): number {
  return epochByGuestId.get(guestId) ?? 0;
}

/** Invalidates every session this guest currently holds, on every browser, immediately. */
export function revokeGuestSessions(guestId: string): void {
  epochByGuestId.set(guestId, currentSessionEpoch(guestId) + 1);
}

/** True if a session stamped with epoch (at mint time) predates guestId's most recent logout. */
export function isSessionRevoked(guestId: string, epoch: number): boolean {
  return epoch < currentSessionEpoch(guestId);
}
