import { NextResponse } from "next/server";
import { getSessionGuestId } from "@/lib/auth/voterSession";

/**
 * Returns the current session's identity (if any) — nothing more. Backs
 * useCheckedInGuest, shared by every guest-facing entry point that needs to
 * know "is this browser already checked in, and as whom" (the home page's
 * Check-In/nav-button gating, previously). Deliberately NOT gated behind
 * any feature flag (unlike GET /api/votes, which 404s when
 * votingModuleEnabled is off): session identity is a cross-cutting concern
 * shared by voting, candy count, and check-in alike, so a module being
 * disabled must never make identity resolution itself fail for the others.
 */
export async function GET() {
  const guestId = await getSessionGuestId();
  return NextResponse.json({ guestId });
}
