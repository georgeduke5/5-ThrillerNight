import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getGuestCheckInStatus } from "@/lib/auth/guestStatus";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
  getVoterSessionPayload,
  hasSessionFor,
  switchActiveSessionToken,
} from "@/lib/auth/voterSession";

/**
 * The "Not you?" no-reverification fast path: if guestId already has a
 * still-valid session on this browser (they verified earlier tonight, or
 * are switching back to a guest who verified before someone else took
 * over), switch to it immediately with no phone/code prompt. Otherwise
 * reports that a fresh verification is needed — the caller then falls
 * through to the existing POST /api/auth/phone/start + verify flow (which
 * merges the new session in, see verify/route.ts), the same flow already
 * used for check-in and vote-time verification.
 *
 * Reports the switched-to guest's current pendingApproval status too: this
 * is the one path that can switch a guest's identity "live" within an
 * already-open page (e.g. VotingApp) rather than via a fresh page
 * navigation, so the caller needs this to route to the pending landing
 * screen itself (see VerifyIdentityModal's goToPendingLanding) — the
 * site-wide proxy lockdown only runs on navigation, not a client-side
 * session switch.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const payload = await getVoterSessionPayload();
  if (!payload || !hasSessionFor(payload, guestId)) {
    return NextResponse.json({ switched: false, requiresVerification: true });
  }

  const guest = await getDataStore().getGuestById(guestId);
  const pendingApproval = guest ? getGuestCheckInStatus(guest) === "pending" : false;

  const response = NextResponse.json({ switched: true, pendingApproval });
  response.cookies.set(VOTER_SESSION_COOKIE, switchActiveSessionToken(payload, guestId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VOTER_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
