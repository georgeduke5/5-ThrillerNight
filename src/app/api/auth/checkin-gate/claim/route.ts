import { NextRequest, NextResponse } from "next/server";
import { matchesCurrentToken, CHECKIN_GATE_COOKIE, CHECKIN_GATE_MAX_AGE_SECONDS } from "@/lib/auth/checkInGate";
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

  const valid = await matchesCurrentToken(token);
  if (!valid) {
    return NextResponse.json({ ok: false });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(CHECKIN_GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: CHECKIN_GATE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
