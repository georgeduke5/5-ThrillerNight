import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { VOTER_SESSION_COOKIE, resolveSessionGuestId } from "@/lib/auth/voterSession";

const PENDING_LANDING_PATH = "/check-in/pending";

/**
 * Site-wide lockdown for a guest whose check-in is still pending admin
 * approval (see Guest.pendingApprovalAt): they get exactly one page, the
 * landing/waiting screen, and nothing else — enforced here so a direct
 * navigation or a refresh can't route around it the way a client-side-only
 * check could. The matcher below scopes this to exactly the pages a
 * checked-in guest actually uses; a future module's page needs adding there
 * too, or this lockdown silently won't cover it.
 *
 * Proxy defaults to the Node.js runtime as of Next.js 16 (middleware.js was
 * renamed and this changed — see node_modules/next/dist/docs/.../proxy.md),
 * which this relies on: resolving a guest's status means a real Google
 * Sheets read via getDataStore(), not something an Edge-safe proxy could do.
 *
 * Only ever reads the sheet for a request that already carries a session
 * cookie — an anonymous visitor (the common case for a first page load)
 * resolves to no guestId and skips the lookup entirely.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(VOTER_SESSION_COOKIE)?.value;
  const guestId = resolveSessionGuestId(token);
  if (!guestId) return NextResponse.next();

  const guest = await getDataStore().getGuestById(guestId);
  if (guest?.pendingApprovalAt) {
    return NextResponse.redirect(new URL(PENDING_LANDING_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/vote", "/vote/:path*", "/candy-count", "/candy-count/:path*"],
};
