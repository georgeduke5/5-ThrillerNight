import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getGuestCheckInStatus } from "@/lib/auth/guestStatus";
import { isCheckInGateOpenForRequest } from "@/lib/auth/checkInGate";
import { isValidId } from "@/lib/validation";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
  createVoterSessionToken,
  getVoterSessionPayload,
  hasSessionFor,
  switchActiveSessionToken,
} from "@/lib/auth/voterSession";

/**
 * The true last resort: a guest whose passkey flow fails or can't complete
 * (no passkey support, lost phone, etc.) lands here — see
 * VerifyIdentityModal's failure screen, "Check in with an admin". No proof
 * of identity happens at all, so this route can ONLY ever file a
 * pending-approval request. It never grants access by itself:
 *
 * - A guest with no prior status is marked pending (the same queue the
 *   no-phone passkey path feeds, reviewed on /admin/check-in) and this
 *   browser gets a session bound to that *pending* guest. That session is
 *   inert until an admin approves them: src/proxy.ts pins it to the
 *   /check-in/pending waiting screen, and voting, candy guessing, and photo
 *   upload all reject it server-side (see hasFullCheckInAccess).
 * - A guest who is already approved is refused outright, with no session.
 *   Previously this branch restored a full session for them, which let
 *   anyone pick an already-checked-in guest's name, tap this button, and
 *   vote as them with no verification at all.
 * - A guest who is already pending is refused too, unless this same browser
 *   already holds that guest's (inert) session — otherwise a second device
 *   could attach itself to someone else's open request and be unlocked
 *   along with them when an admin approves it.
 *
 * Gated on inPersonCheckInEnabled — not passkeyAuthEnabled — since the two
 * toggles are independent, and on the party-presence gate like every other
 * route reachable with nothing but a guestId (see checkInGate.ts).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!isValidId(guestId)) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }
  if (!(await isCheckInGateOpenForRequest())) {
    return NextResponse.json({ error: "Check-in requires tonight's QR code." }, { status: 403 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.inPersonCheckInEnabled) {
    return NextResponse.json({ error: "In-person check-in is not enabled." }, { status: 403 });
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  const existingPayload = await getVoterSessionPayload();
  const currentStatus = getGuestCheckInStatus(guest);

  if (currentStatus === "approved") {
    return NextResponse.json(
      {
        error:
          "This guest is already checked in. Sign in with your passkey, or find George or Sarah to help.",
      },
      { status: 409 },
    );
  }

  let token: string;
  if (currentStatus === "pending") {
    if (!existingPayload || !hasSessionFor(existingPayload, guestId)) {
      return NextResponse.json(
        { error: "A check-in request for this guest is already waiting. Please find George or Sarah." },
        { status: 409 },
      );
    }
    token = switchActiveSessionToken(existingPayload, guestId);
  } else {
    await store.markGuestPendingApproval(guestId);
    // Re-read rather than trust the write: markGuestPendingApproval is a
    // no-op if the guest was checked in between the read above and now, and
    // that case must not fall through to issuing a session.
    const updated = await store.getGuestById(guestId);
    if (!updated || getGuestCheckInStatus(updated) !== "pending") {
      return NextResponse.json(
        { error: "Couldn't file your check-in request. Please find George or Sarah." },
        { status: 409 },
      );
    }
    token = createVoterSessionToken(existingPayload, guestId);
  }

  const response = NextResponse.json({ ok: true, guestId, pendingApproval: true });
  response.cookies.set(VOTER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: VOTER_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
