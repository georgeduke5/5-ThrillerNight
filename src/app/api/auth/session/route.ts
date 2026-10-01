import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSessionGuestId } from "@/lib/auth/voterSession";

/**
 * Returns the current session's identity (if any), plus whether that guest
 * is admin-flagged. Backs useCheckedInGuest, shared by every guest-facing
 * entry point that needs to know "is this browser already checked in, and
 * as whom" (the home page's Check-In/nav-button gating, and — now —
 * whether to show the "Admin" link). Deliberately NOT gated behind any
 * feature flag (unlike GET /api/votes, which 404s when votingModuleEnabled
 * is off): session identity is a cross-cutting concern shared by voting,
 * candy count, and check-in alike, so a module being disabled must never
 * make identity resolution itself fail for the others.
 *
 * `isAdmin` is computed here — a server-side lookup against the full Guest
 * record — rather than left for the client to read off GET /api/guests,
 * whose public shape deliberately never includes this field at all (see
 * Guest.isAdmin). This is informational only, for showing or hiding the
 * link; it is never what actually gates /admin/* itself — that's
 * adminAccess.ts's isAdminRequest(), re-checked independently server-side
 * on every admin request.
 */
export async function GET() {
  const guestId = await getSessionGuestId();
  if (!guestId) {
    return NextResponse.json({ guestId: null, isAdmin: false });
  }
  const guest = await getDataStore().getGuestById(guestId);
  return NextResponse.json({ guestId, isAdmin: guest?.isAdmin === true });
}
