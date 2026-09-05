import { NextResponse } from "next/server";
import { VOTER_SESSION_COOKIE } from "@/lib/auth/voterSession";

/**
 * Clears the voter session cookie (the "Not you?" affordance on /vote).
 * Since identity is now solely the session cookie, "switching voter" means
 * actually invalidating this device's session, not just forgetting a
 * client-side selection.
 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(VOTER_SESSION_COOKIE, "", { maxAge: 0, path: "/" });
  return response;
}
