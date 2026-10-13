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
 * Strips surrounding whitespace and one layer of wrapping quotes. Root
 * cause of a real bug: an admin recovering access (see README's "Recovering
 * admin access after your session expires") copies the token by hand out
 * of a Settings-sheet cell, and depending on exactly how that selection/copy
 * is done, it's easy to pick up a stray leading/trailing space or end up
 * wrapped in quotes — a byte-for-byte comparison then fails the token
 * outright even though it's the right one, with no indication why. Applied
 * to both sides of every comparison below (not just the presented token):
 * the stored value is written RAW via the Sheets API by this app itself
 * (see GoogleSheetsDataStore's valueInputOption, confirmed not to mangle
 * it), so in practice only the presented side ever needs this, but
 * normalizing both is cheap and removes the assumption entirely.
 */
export function normalizeToken(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
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
  return safeEqual(normalizeToken(candidate), normalizeToken(stored));
}

/** Whether this request's browser currently holds a gate cookie that still matches the current stored token. */
export async function isCheckInGateOpenForRequest(): Promise<boolean> {
  const cookieValue = (await cookies()).get(CHECKIN_GATE_COOKIE)?.value;
  return matchesCurrentToken(cookieValue);
}
