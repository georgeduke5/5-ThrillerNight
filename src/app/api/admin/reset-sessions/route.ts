import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { revokeGuestSessions } from "@/lib/auth/sessionRevocation";

/**
 * Admin-only, destructive: "Remove all login sessions and passkey data" on
 * /admin/security's Danger Zone.
 *
 * - Deletes every Passkeys row belonging to a non-admin guest
 *   (DataStore.deleteNonAdminPasskeys) — admin guests' passkeys are left
 *   alone, so no admin locks themselves out of /admin. In the same step,
 *   every guest whose passkey is deleted is reset to pending approval
 *   (DataStore.resetGuestsToPending), so no one is left checked in with
 *   no credential for someone else to register over.
 * - Stamps DataStore.setSessionsInvalidBefore(now), the persistent,
 *   Settings-sheet-backed mechanism every session-resolution path checks
 *   (see voterSession.ts's applySessionsResetFilter and proxy.ts) —
 *   every non-admin session on every browser stops being trusted on its
 *   very next request, without waiting for its natural 12-hour expiry.
 *   Admin sessions, including this admin's own, are explicitly exempt.
 * - Also bumps the in-memory per-guest revocation epoch (sessionRevocation.ts)
 *   for each affected guest, belt-and-suspenders: this instance stops
 *   trusting their session immediately, rather than only once it re-reads
 *   the persistent timestamp. The persistent timestamp is what actually
 *   covers every *other* serverless instance and survives a cold start.
 * - There is no server-side storage for an in-progress passkey
 *   registration or phone-gate ceremony to drop — the passkey challenge
 *   cookie (passkeyChallenge.ts) is a stateless, HMAC-signed cookie held
 *   entirely by the guest's own browser, and the on-file-phone SMS code is
 *   managed by Twilio Verify, which this app never stores anything for
 *   either. Nothing to do here for that part.
 * - Never touches Groups, CandyGuesses, Votes, or any other Settings
 *   value. On Guests it changes only the check-in status of the guests
 *   whose passkeys were deleted (see above).
 */
export async function POST() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = getDataStore();
  const [{ deleted, guestIds }] = await Promise.all([
    store.deleteNonAdminPasskeys(),
    store.setSessionsInvalidBefore(Date.now()),
  ]);
  for (const guestId of guestIds) {
    revokeGuestSessions(guestId);
  }

  return NextResponse.json({ ok: true, passkeysDeleted: deleted });
}
