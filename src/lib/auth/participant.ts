import "server-only";
import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSessionGuestId } from "./voterSession";
import { hasFullCheckInAccess } from "./guestStatus";

/**
 * For guest-facing routes that change shared data (groups, for now): the
 * active session's guest id, or a ready-to-return 401/403 if there's no
 * session or the guest isn't fully checked in. A pending session is
 * read-only — it exists only to show the waiting screen.
 */
export async function requireCheckedInGuest(): Promise<{ guestId: string } | { response: NextResponse }> {
  const guestId = await getSessionGuestId();
  if (!guestId) {
    return {
      response: NextResponse.json(
        { error: "Phone verification required.", requiresVerification: true },
        { status: 401 },
      ),
    };
  }
  const guest = await getDataStore().getGuestById(guestId);
  if (!guest || !hasFullCheckInAccess(guest)) {
    return {
      response: NextResponse.json(
        { error: "Your check-in is still waiting on admin approval." },
        { status: 403 },
      ),
    };
  }
  return { guestId };
}
