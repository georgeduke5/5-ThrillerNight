import { NextRequest, NextResponse } from "next/server";
import {
  matchesCurrentToken,
  normalizeToken,
  CHECKIN_GATE_COOKIE,
  CHECKIN_GATE_MAX_AGE_SECONDS,
} from "@/lib/auth/checkInGate";
import { isRateLimited, recordHit, getClientIp } from "@/lib/rateLimit";

// The token itself has ~192 bits of entropy, far beyond brute-forcing — this
// is defense in depth against the attempt itself (log noise, wasted Sheets
// reads), keyed by IP since there's no guestId involved yet at this point.
const CLAIM_RATE_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

/**
 * The guest-facing half of the party-presence gate: checks a token
 * presented from a scanned QR-code URL (see /admin/security's "Generate New
 * Code") against the currently stored one and, on a match, remembers it for
 * this browser in a short-lived cookie — see checkInGate.ts for exactly
 * what that cookie does and doesn't grant. Called once, on landing on the
 * home page with a `?token=` query string parameter (see
 * HomeNavButtons.tsx); never trusts the token's validity itself, always
 * re-checks server-side against DataStore.getCheckInGateToken.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { token?: string } | null;
  const token = body?.token;
  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, error: "A token is required." }, { status: 400 });
  }

  const ipKey = `checkin-gate-claim:${getClientIp(request)}`;
  if (isRateLimited(ipKey, CLAIM_RATE_LIMIT)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }
  recordHit(ipKey, CLAIM_RATE_LIMIT);

  // A Sheets read failure here (a real production incident: auth hiccup,
  // rate limit, transient network error) must never read the same as "this
  // token is wrong" — those are different problems with different fixes,
  // and conflating them left a guest with a perfectly good token stuck on
  // the locked screen with zero indication anything was even attempted.
  // Returns a distinct status (503, not 400/200) specifically so the
  // client can tell "temporarily unavailable, retry" from "this code is
  // invalid, go get the current one" — see HomeNavButtons.tsx.
  let valid: boolean;
  try {
    valid = await matchesCurrentToken(token);
  } catch (err) {
    console.error("Failed to verify check-in token:", err);
    return NextResponse.json(
      { ok: false, error: "Couldn't verify the code right now. Please try again." },
      { status: 503 },
    );
  }
  if (!valid) {
    return NextResponse.json({ ok: false });
  }

  const response = NextResponse.json({ ok: true });
  // Stores the NORMALIZED value (see normalizeToken) — matchesCurrentToken
  // just confirmed this equals the real stored token once whitespace/quote
  // artifacts are stripped, so the cookie should hold that clean value too,
  // not whatever stray characters the guest's browser/clipboard happened to
  // carry in the URL. Every later read of this cookie (isCheckInGateOpenForRequest)
  // runs through the same matchesCurrentToken/normalizeToken path anyway, so
  // this is belt-and-suspenders, not load-bearing on its own.
  response.cookies.set(CHECKIN_GATE_COOKIE, normalizeToken(token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CHECKIN_GATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
