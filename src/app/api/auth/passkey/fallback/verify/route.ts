import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { checkVerificationCode, isPhoneTakenByAnotherGuest, normalizePhone } from "@/lib/auth/twilioVerify";
import { getGuestCheckInStatus } from "@/lib/auth/guestStatus";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
  createVoterSessionToken,
  getVoterSessionPayload,
} from "@/lib/auth/voterSession";

/**
 * Stage two of the post-passkey-failure phone fallback (see
 * .../fallback/start). Checks the code against whichever phone this guest
 * is actually using — their on-file number if they have one, otherwise the
 * number they just typed and sent back here — and on success:
 *
 * - persists a newly-typed number to the guest record (an on-file number is
 *   already there, nothing to save), making it this guest's durable
 *   fallback credential for any future session loss;
 * - decides access the same way re-authenticating with a passkey now does
 *   (see the pendingApproval derivation in POST /api/auth/passkey/finish):
 *   proving identity is not the same as being authorized. A guest with no
 *   prior status gets checked in immediately — the same trust a passkey
 *   gets. A guest already sitting in pending stays pending: this only
 *   restores their session, it never substitutes for George/Sarah's
 *   approval. A guest already approved is simply restored to full access.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    guestId?: string;
    phone?: string;
    code?: string;
  } | null;
  const guestId = body?.guestId;
  const code = body?.code?.trim();
  if (!guestId || !code) {
    return NextResponse.json({ error: "guestId and code are required." }, { status: 400 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.passkeyAuthEnabled || !status.phoneVerificationEnabled) {
    return NextResponse.json({ error: "Phone verification is not enabled." }, { status: 403 });
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  const isNewPhone = !guest.phone;
  const phoneToCheck = guest.phone ?? body?.phone?.trim();
  if (!phoneToCheck) {
    return NextResponse.json({ error: "A phone number is required." }, { status: 400 });
  }

  if (isNewPhone && (await isPhoneTakenByAnotherGuest(store, phoneToCheck, guestId))) {
    // Re-checked here, not just at /start: closes the race where two
    // different guests enter the same new number between the two calls.
    return NextResponse.json(
      { error: "That phone number is already on file for another guest." },
      { status: 409 },
    );
  }

  let approved: boolean;
  try {
    approved = await checkVerificationCode(normalizePhone(phoneToCheck), code);
  } catch (err) {
    console.error("Failed to check fallback verification code:", err);
    return NextResponse.json({ error: "Failed to check verification code." }, { status: 502 });
  }
  if (!approved) {
    return NextResponse.json({ error: "Incorrect or expired code." }, { status: 401 });
  }

  if (isNewPhone) {
    await store.updateGuest(guestId, { phone: phoneToCheck });
  }

  const currentStatus = getGuestCheckInStatus(guest);
  if (currentStatus === "none") {
    await store.markGuestCheckedIn(guestId);
  }
  // "pending" stays pending; "approved" is already checked in — nothing
  // more to do for either, beyond issuing the session cookie below.

  const existingPayload = await getVoterSessionPayload();
  const response = NextResponse.json({
    ok: true,
    guestId,
    pendingApproval: currentStatus === "pending",
  });
  response.cookies.set(VOTER_SESSION_COOKIE, createVoterSessionToken(existingPayload, guestId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VOTER_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
