import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
  createVoterSessionToken,
  getVoterSessionPayload,
} from "@/lib/auth/voterSession";

/**
 * Sibling to POST /api/auth/phone/verify for when an admin has flipped the
 * "Phone Verification" kill switch off (VotingStatus.phoneVerificationEnabled
 * — VotingControls.tsx, for when Twilio itself is misbehaving): issues the
 * exact same session cookie and calls the exact same markGuestCheckedIn,
 * just without a real Twilio round-trip. Re-checks phoneVerificationEnabled
 * here server-side on every call — never trusted from the client — so a
 * stale/cached client can't bypass verification once an admin turns it back
 * on.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (status.phoneVerificationEnabled) {
    return NextResponse.json(
      { error: "Phone verification is currently required." },
      { status: 403 },
    );
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  await store.markGuestCheckedIn(guestId);

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
