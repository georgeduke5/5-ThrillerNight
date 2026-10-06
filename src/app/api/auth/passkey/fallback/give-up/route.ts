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
 * The true last resort: a guest who can't complete a passkey ceremony OR
 * the phone fallback (no signal, can't receive a code, etc.) lands here —
 * see VerifyIdentityModal's "Still having trouble?" link, offered alongside
 * the phone fallback. No proof of identity happens at all, the same trust
 * level as the self-service walk-in form, so a guest with no prior status
 * is placed in the exact same pending-approval queue the no-phone passkey
 * path already feeds — same Check-in admin page, no separate list — with
 * full site access except voting, candy guessing, and photo upload until
 * George/Sarah approve them in person. A guest already pending or approved
 * just gets their session restored at whatever status they already had;
 * this never downgrades an approved guest.
 *
 * This is the live implementation of the check-in method-selection screen's
 * "In-Person" option (the route's name and location are a historical
 * leftover from when it was reachable only as a fallback chained off the
 * passkey ceremony), so it gates on inPersonCheckInEnabled — not
 * passkeyAuthEnabled — since the two methods are independent and either can
 * be toggled off without affecting the other.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!isValidId(guestId)) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
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

  const currentStatus = getGuestCheckInStatus(guest);
  if (currentStatus === "none") {
    await store.markGuestPendingApproval(guestId);
  }

  const existingPayload = await getVoterSessionPayload();
  const response = NextResponse.json({
    ok: true,
    guestId,
    pendingApproval: currentStatus !== "approved",
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
