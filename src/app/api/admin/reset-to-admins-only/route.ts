import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { revokeGuestSessions } from "@/lib/auth/sessionRevocation";

/**
 * Admin-only, destructive: "Reset to admins only" on /admin/security's
 * Danger Zone — the full pre-party reset.
 *
 * - DataStore.resetToAdminsOnly() deletes every Guests row except the ones
 *   currently flagged isAdmin true (left completely untouched — same row,
 *   nothing re-written) and blanks every row in Votes, CandyGuesses, and
 *   Passkeys outright, with no exception for admins: an admin's own votes,
 *   guesses, and passkey are wiped exactly like everyone else's. Groups
 *   and every other Settings value (including the check-in gate token)
 *   are untouched.
 * - DataStore.setAllSessionsInvalidBefore(now) is the NO-exemption
 *   counterpart to setSessionsInvalidBefore (see /reset-sessions): every
 *   session minted before this call, admin or not, stops being trusted —
 *   checked by every session-resolution path (voterSession.ts's
 *   applySessionsResetFilter, proxy.ts) on their very next request. This
 *   includes the admin who just triggered this action; their *current*
 *   request still completes normally below (the HTTP response for this
 *   call was already authorized at the top of this handler and isn't
 *   retroactively undone), so they see a clean success response here —
 *   the sign-out only takes effect on their next navigation or API call.
 * - Also bumps the in-memory per-guest revocation epoch
 *   (sessionRevocation.ts) for every guest who existed before this reset —
 *   kept admins and deleted non-admins alike — as an immediate,
 *   same-instance belt-and-suspenders on top of the persistent threshold,
 *   same pattern as /reset-sessions already uses.
 * - There is no server-side storage for an in-progress passkey
 *   registration or phone-gate ceremony to drop — same reasoning as
 *   /reset-sessions: the passkey challenge cookie is stateless and
 *   browser-held, and Twilio Verify keeps no state of its own either.
 */
export async function POST() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const store = getDataStore();
  const result = await store.resetToAdminsOnly();
  await store.setAllSessionsInvalidBefore(Date.now());
  for (const guestId of result.allGuestIds) {
    revokeGuestSessions(guestId);
  }

  return NextResponse.json({
    ok: true,
    guestsDeleted: result.guestsDeleted,
    adminsKept: result.adminsKept,
    votesCleared: result.votesCleared,
    guessesCleared: result.guessesCleared,
    passkeysCleared: result.passkeysCleared,
  });
}
