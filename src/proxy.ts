import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { VOTER_SESSION_COOKIE, resolveActiveSessionEntry } from "@/lib/auth/voterSession";

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
 * Also the enforcement point for the admin's "Remove all login sessions"
 * action (/admin/security's Danger Zone, DataStore.getSessionsInvalidBefore)
 * for page navigation: a non-admin session minted before that reset is
 * cleared here, immediately, rather than left to expire naturally. Reuses
 * the one guest read below for both checks (pendingApprovalAt AND the
 * admin exemption) and adds exactly one more read — a fresh, uncached
 * Settings lookup, since this must take effect right away — so this
 * remains the same "one read for an anonymous request costs nothing, an
 * authenticated one costs a small bounded number of reads" shape it always
 * has. See voterSession.ts's applySessionsResetFilter for the equivalent
 * check every OTHER session-resolution path (API routes, server
 * components) applies.
 *
 * Proxy defaults to the Node.js runtime as of Next.js 16 (middleware.js was
 * renamed and this changed — see node_modules/next/dist/docs/.../proxy.md),
 * which this relies on: resolving a guest's status means a real Google
 * Sheets read via getDataStore(), not something an Edge-safe proxy could do.
 *
 * Only ever reads the sheet for a request that already carries a session
 * cookie — an anonymous visitor (the common case for a first page load)
 * resolves to no session entry and skips every lookup entirely.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(VOTER_SESSION_COOKIE)?.value;
  const entry = resolveActiveSessionEntry(token);
  if (!entry) return NextResponse.next();

  const store = getDataStore();
  const [guest, sessionsInvalidBefore] = await Promise.all([
    store.getGuestById(entry.guestId),
    store.getSessionsInvalidBefore(),
  ]);

  if (sessionsInvalidBefore !== null && entry.iat < sessionsInvalidBefore && !guest?.isAdmin) {
    // Treat exactly like no session at all — the guest-facing pages this
    // matcher covers already handle "not checked in" gracefully, so there's
    // no need to redirect anywhere, just stop trusting the dead cookie.
    const response = NextResponse.next();
    response.cookies.delete(VOTER_SESSION_COOKIE);
    return response;
  }

  if (guest?.pendingApprovalAt) {
    return NextResponse.redirect(new URL(PENDING_LANDING_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/vote", "/vote/:path*", "/candy-count", "/candy-count/:path*"],
};
