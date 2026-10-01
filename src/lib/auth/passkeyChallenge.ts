import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export const PASSKEY_CHALLENGE_COOKIE = "tn_passkey_challenge";
/** One ceremony's worth of time — SimpleWebAuthn's own option timeout is 60s. */
const CHALLENGE_TTL_MS = 1000 * 60 * 5;
export const PASSKEY_CHALLENGE_MAX_AGE_SECONDS = CHALLENGE_TTL_MS / 1000;

export type PasskeyCeremony = "registration" | "authentication";

export interface PasskeyChallengePayload {
  guestId: string;
  /** Base64URL challenge handed to the authenticator by the begin endpoint. */
  challenge: string;
  /**
   * Which ceremony this challenge was issued for. Kept server-side in the
   * signed cookie rather than accepted from the request body so a client
   * can't ask to "authenticate" against a challenge that was issued for a
   * registration (or register over an existing credential by relabeling the
   * call) — /finish reads the ceremony from here, never from the caller.
   */
  ceremony: PasskeyCeremony;
  /**
   * Only meaningful when ceremony is "registration". True when this
   * registration is an intentional *replacement* of a credential the guest
   * already has on file — the recovery path for a guest whose device no
   * longer has the passkey the Passkeys sheet still lists for them (e.g.
   * they cleared their device's saved passkeys, got a new phone, etc.).
   * Without this, /finish's "already has a passkey" guard would block the
   * very re-registration this flow exists to allow. Defaults to false for
   * any older cookie that predates this field, which correctly preserves
   * the guard for a plain first-time registration.
   */
  allowOverwrite?: boolean;
  exp: number;
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing required environment variable: SESSION_SECRET.");
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

/**
 * Signs a pending ceremony into a short-lived cookie.
 *
 * WebAuthn needs the challenge issued at /begin to still be known at
 * /finish. An in-process Map would work locally and then silently fail on
 * Vercel, where the two requests routinely land on different lambda
 * instances — so the challenge travels with the client instead, HMAC-signed
 * so it can't be forged or swapped. Same signed-cookie construction (and
 * the same SESSION_SECRET) as voterSession.ts; the distinct
 * cookie name and payload shape keep the three from ever being interchanged.
 */
export function encodePasskeyChallenge(
  payload: Omit<PasskeyChallengePayload, "exp">,
): string {
  const json = JSON.stringify({ ...payload, exp: Date.now() + CHALLENGE_TTL_MS });
  const encoded = Buffer.from(json, "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/** Verifies the signature and expiry, returning null for anything missing, forged, or stale. */
export function decodePasskeyChallenge(
  token: string | undefined | null,
): PasskeyChallengePayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const provided = Buffer.from(signature);
  const expected = Buffer.from(sign(encoded));
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8"),
    ) as PasskeyChallengePayload;
    if (typeof payload.challenge !== "string" || typeof payload.guestId !== "string") return null;
    if (payload.ceremony !== "registration" && payload.ceremony !== "authentication") return null;
    if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Signs a pending ceremony into the response's challenge cookie — the
 * shared counterpart to encodePasskeyChallenge, used by every endpoint that
 * hands WebAuthn options to the browser (/begin, and the phone-gate/verify
 * step that hands out registration options once a first-time guest's phone
 * check has passed) so they all set the cookie identically.
 */
export function setPasskeyChallengeCookie(
  response: NextResponse,
  payload: Omit<PasskeyChallengePayload, "exp">,
): void {
  response.cookies.set(PASSKEY_CHALLENGE_COOKIE, encodePasskeyChallenge(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: PASSKEY_CHALLENGE_MAX_AGE_SECONDS,
    path: "/",
  });
}

/** Reads the pending ceremony for this request, or null if there isn't a valid one. */
export async function getPasskeyChallenge(): Promise<PasskeyChallengePayload | null> {
  const token = (await cookies()).get(PASSKEY_CHALLENGE_COOKIE)?.value;
  return decodePasskeyChallenge(token);
}
