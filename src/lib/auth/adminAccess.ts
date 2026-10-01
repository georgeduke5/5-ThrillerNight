import "server-only";
import { getDataStore } from "@/lib/data-access";
import { getSessionGuestId } from "./voterSession";

/**
 * Admin access has no authentication mechanism of its own — there is no
 * admin password, no separate admin session cookie. It is purely an
 * authorization check layered on top of the existing passkey-verified voter
 * session: whoever the browser's *active* checked-in guest currently is
 * (see voterSession.ts — a browser can hold several verified identities at
 * once, e.g. a parent and child, but only one is "active" for
 * browsing/acting), looked up fresh against the Guests sheet's `isAdmin`
 * column on every call. No caching, no admin-specific cookie to go stale or
 * leak: revoking a guest's isAdmin flag in the sheet takes effect on their
 * very next request.
 *
 * This also means admin status is tied to a *specific device's* active
 * session, same as voting — an admin-flagged guest who hasn't verified a
 * passkey on this browser yet, or who has switched their active identity to
 * someone else via "Not you?", does not get admin access until they're the
 * active session again.
 *
 * For use in server components / layouts / route handlers to gate admin
 * access — unchanged call signature from the old password-based version it
 * replaces, so every existing call site needed only an import-path update.
 */
export async function isAdminRequest(): Promise<boolean> {
  const guestId = await getSessionGuestId();
  if (!guestId) return false;
  const guest = await getDataStore().getGuestById(guestId);
  return guest?.isAdmin === true;
}
