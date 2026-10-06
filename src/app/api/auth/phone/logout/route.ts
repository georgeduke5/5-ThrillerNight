import { NextResponse } from "next/server";
import { VOTER_SESSION_COOKIE, getVoterSessionPayload } from "@/lib/auth/voterSession";
import { revokeGuestSessions } from "@/lib/auth/sessionRevocation";

/**
 * Clears the voter session cookie (the "Not you?" affordance on /vote).
 * Since identity is now solely the session cookie, "switching voter" means
 * actually invalidating this device's session, not just forgetting a
 * client-side selection — revoking every guest identity this cookie
 * currently holds (see AdminLogoutButton's doc comment: "every guest
 * identity verified on this browser, not just the active one") server-side
 * first, so a copy of the old cookie value taken before this call can't be
 * replayed back in afterward. Clearing the cookie alone would only stop
 * *this* browser from resubmitting it.
 */
export async function POST() {
  const payload = await getVoterSessionPayload();
  for (const session of payload?.sessions ?? []) {
    revokeGuestSessions(session.guestId);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(VOTER_SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
