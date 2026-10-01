import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
  createVoterSessionToken,
  getVoterSessionPayload,
} from "@/lib/auth/voterSession";

/**
 * The no-credential-at-all fallback for a guest's very first identity
 * attempt, when they can't or won't complete a WebAuthn ceremony on this
 * device at all (unsupported browser, broken biometric reader, doesn't
 * trust it, etc.) — see VerifyIdentityModal's "Sign in anyway" link, shown
 * only during a genuine first-time registration attempt.
 *
 * No cryptographic proof of identity happens here — this is a self-asserted
 * name, the same trust level as the self-service walk-in form — so the
 * outcome is never "checked in" outright: it's exactly the existing
 * pending-approval state a no-phone passkey registration already lands in
 * (see Guest.pendingApprovalAt), reusing the very same decision POST
 * /api/auth/passkey/finish makes. An admin approving them on
 * /admin/check-in flips them to checked-in without touching this session —
 * the guest never re-authenticates, voting/guessing just unlocks on their
 * next request once the pending flag is gone (see the pendingApprovalAt
 * checks in POST /api/votes and POST /api/candy-count).
 *
 * Still fully gated server-side, never just hidden client-side: a guest
 * with a phone on file and phoneVerificationEnabled on must still go
 * through the phone-gate (.../phone-gate/start + /verify) — calling this
 * endpoint directly for that guest is refused below, so the fallback can
 * never be used to skip a phone check that would otherwise be required.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.passkeyAuthEnabled) {
    return NextResponse.json({ error: "Passkey login is not enabled." }, { status: 403 });
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  // Only ever a stand-in for a genuine first-time passkey registration —
  // never a way to bypass an existing credential's authentication.
  const existing = await store.getPasskeyByGuestId(guestId);
  if (existing) {
    return NextResponse.json({ error: "This guest already has a passkey registered." }, { status: 409 });
  }

  // A guest with a phone on file (and the kill switch on) must still prove
  // it via the phone gate — this endpoint only ever applies where /begin
  // would otherwise register them directly (no phone, or the kill switch
  // off entirely).
  if (status.phoneVerificationEnabled && guest.phone) {
    return NextResponse.json(
      { error: "This guest has a phone on file and must verify it first." },
      { status: 403 },
    );
  }

  // Same decision POST /api/auth/passkey/finish makes for a genuine
  // first-time registration: no phone + the kill switch on means pending
  // approval (full site access, held out of "checked in" until an admin
  // confirms them); the kill switch off means the admin has opted out of
  // verification altogether, so this must never add more friction than
  // leaving it on would for a no-phone guest — straight to checked-in.
  let pendingApproval = false;
  if (status.phoneVerificationEnabled && !guest.phone) {
    await store.markGuestPendingApproval(guestId);
    pendingApproval = true;
  } else {
    await store.markGuestCheckedIn(guestId);
  }

  // Same merge-don't-replace behavior as every other verification path, so
  // a parent who signs in for a second child on the same phone doesn't sign
  // the first one out — see voterSession.ts.
  const existingPayload = await getVoterSessionPayload();
  const response = NextResponse.json({ ok: true, guestId, pendingApproval });
  response.cookies.set(VOTER_SESSION_COOKIE, createVoterSessionToken(existingPayload, guestId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VOTER_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
