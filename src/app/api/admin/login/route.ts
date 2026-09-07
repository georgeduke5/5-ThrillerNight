import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifyAdminPassword,
} from "@/lib/auth/adminSession";
import { clearRateLimit, getClientIp, isRateLimited, recordHit } from "@/lib/rateLimit";

// Lock out after 5 failed attempts from the same IP for 15 minutes. A
// correct password always clears the counter (see clearRateLimit below) —
// only failures count toward the lockout.
const LOGIN_RATE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

export async function POST(request: NextRequest) {
  const rateLimitKey = `admin-login:${getClientIp(request)}`;

  if (isRateLimited(rateLimitKey, LOGIN_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Please try again in 15 minutes." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as { password?: string } | null;
  const password = body?.password;

  if (!password || !verifyAdminPassword(password)) {
    recordHit(rateLimitKey, LOGIN_RATE_LIMIT);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  clearRateLimit(rateLimitKey);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
