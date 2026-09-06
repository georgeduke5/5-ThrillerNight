import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { checkVerificationCode, normalizePhone } from "@/lib/auth/twilioVerify";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
  createVoterSessionToken,
  getVoterSessionPayload,
} from "@/lib/auth/voterSession";

/**
 * Stage two: checks the code the guest received, and on success issues a
 * signed session cookie bound to their guestId (see voterSession.ts) so
 * they don't need to re-verify on every subsequent vote change this
 * session. No phone number is persisted anywhere — Twilio Verify is
 * stateless from our side, and this is deliberately a lightweight
 * per-session gate with no cross-guest phone binding.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    guestId?: string;
    phone?: string;
    code?: string;
  } | null;

  const guestId = body?.guestId;
  const phone = body?.phone?.trim();
  const code = body?.code?.trim();

  if (!guestId || !phone || !code) {
    return NextResponse.json({ error: "guestId, phone, and code are required." }, { status: 400 });
  }

  const guest = await getDataStore().getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  let approved: boolean;
  try {
    approved = await checkVerificationCode(normalizePhone(phone), code);
  } catch (err) {
    console.error("Failed to check verification code:", err);
    return NextResponse.json({ error: "Failed to check verification code." }, { status: 502 });
  }

  if (!approved) {
    return NextResponse.json({ error: "Incorrect or expired code." }, { status: 401 });
  }

  // Marks the guest checked in regardless of which flow (the dedicated
  // "Check In" button, or the per-vote verification prompt) got them here —
  // both end up at this same endpoint, and the resulting state (a verified
  // phone, a session cookie bound to this guest) is identical either way.
  await getDataStore().markGuestCheckedIn(guestId);

  // Merges this guest's new session into whatever's already on this
  // browser rather than replacing it, so verifying as a second guest here
  // (e.g. a parent verifying on behalf of a child) doesn't sign anyone
  // else out — see voterSession.ts.
  const existingPayload = await getVoterSessionPayload();

  const response = NextResponse.json({ ok: true });
  response.cookies.set(VOTER_SESSION_COOKIE, createVoterSessionToken(existingPayload, guestId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VOTER_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
