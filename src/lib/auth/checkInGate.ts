import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDataStore } from "@/lib/data-access";

/**
 * The party-presence gate: a single admin-generated token (see
 * DataStore.getCheckInGateToken / POST /api/admin/checkin-gate/generate)
 * that a guest must present — by scanning the QR code on /admin/security,
 * which encodes a URL carrying it as a query string parameter — before
 * VerifyIdentityModal will let them start a fresh verification. Once
 * presented and matched, it's remembered for this browser via a plain
 * (unsigned — see the comment on CHECKIN_GATE_COOKIE below)
 * httpOnly cookie, re-checked against the *current* stored token on every
 * use so a newly generated token immediately supersedes it, same as the
 * admin's own copy.
 *
 * This cookie grants nothing by itself beyond "allowed to start the
 * authentication flow" — it is never treated as proof of identity, and
 * carries no guestId. The actual identity/session boundary is still
 * entirely voterSession.ts's cookie, untouched by any of this.
 */
export const CHECKIN_GATE_COOKIE = "tn_checkin_gate";

// Long enough to comfortably finish SMS + a fumbled passkey ceremony after
// scanning, short of anything that could read as "standing access" — the
// admin can also outright invalidate it early by generating a new token.
export const CHECKIN_GATE_MAX_AGE_SECONDS = 60 * 60 * 2;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths rather than just returning
  // false, so that case has to be handled before calling it — still
  // constant-time in the sense that matters: nothing here leaks *how much*
  // of the token matched.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * True if `candidate` — a token freshly presented from a scanned URL, or
 * one already sitting in a guest's gate cookie — matches the currently
 * stored party-presence token. The single check both
 * POST /api/auth/checkin-gate/claim and the gate-status read in
 * GET /api/votes/status funnel through, so "superseded by the next
 * generated token" is enforced in exactly one place.
 */
export async function matchesCurrentToken(candidate: string | null | undefined): Promise<boolean> {
  if (!candidate) return false;
  const stored = await getDataStore().getCheckInGateToken();
  if (!stored) return false;
  return safeEqual(candidate, stored);
}

/** Whether this request's browser currently holds a gate cookie that still matches the current stored token. */
export async function isCheckInGateOpenForRequest(): Promise<boolean> {
  const cookieValue = (await cookies()).get(CHECKIN_GATE_COOKIE)?.value;
  return matchesCurrentToken(cookieValue);
}
