import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getGuestCheckInStatus } from "@/lib/auth/guestStatus";
import { isValidId } from "@/lib/validation";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
  createVoterSessionToken,
  getVoterSessionPayload,
} from "@/lib/auth/voterSession";

/**
 * The zero-methods-enabled check-in path: when an admin has turned off
 * Passkey, Phone Verification, AND In-Person (VotingStatus.
 * passkeyAuthEnabled / phoneVerificationEnabled / inPersonCheckInEnabled —
 * see SecurityToggles.tsx), the check-in method-selection screen is skipped
 * entirely and a guest is checked in right after picking their name. This
 * route is the only server-side path that can do that, and it is a
 * distinct path specifically so it can enforce its own precondition: it
 * succeeds ONLY when all three methods are off. If even one is enabled,
 * this rejects outright — it must never become a way to bypass whichever
 * verification method(s) are still turned on, regardless of what any
 * client is showing or has cached. Toggle values are read fresh on every
 * call, never trusted from the request.
 *
 * Issues the exact same kind of session as every other check-in path (see
 * voterSession.ts's merge-not-replace pattern) and marks the guest checked
 * in the same way — unless they're already pending via some other route,
 * which this never silently clears (same guard as .../phone/verify).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!isValidId(guestId)) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (status.passkeyAuthEnabled || status.phoneVerificationEnabled || status.inPersonCheckInEnabled) {
    return NextResponse.json(
      { error: "A check-in method is required." },
      { status: 403 },
    );
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  if (getGuestCheckInStatus(guest) !== "pending") {
    await store.markGuestCheckedIn(guestId);
  }

  const existingPayload = await getVoterSessionPayload();

  const response = NextResponse.json({ ok: true, pendingApproval: getGuestCheckInStatus(guest) === "pending" });
  response.cookies.set(VOTER_SESSION_COOKIE, createVoterSessionToken(existingPayload, guestId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VOTER_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
