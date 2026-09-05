import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

export const VOTER_SESSION_COOKIE = "tn_voter_session";
const VOTER_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours — long enough to cover a full party night
export const VOTER_SESSION_MAX_AGE_SECONDS = VOTER_SESSION_TTL_MS / 1000;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing required environment variable: SESSION_SECRET.");
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

/**
 * Minimal signed-cookie session for a phone-verified voter, mirroring
 * adminSession.ts's pattern but bound to a specific guestId rather than a
 * shared admin role. Deliberately reuses SESSION_SECRET rather than a
 * second secret — the distinct cookie name and payload shape already
 * prevent any cross-use between admin and voter tokens.
 */
export function createVoterSessionToken(guestId: string): string {
  const payload = JSON.stringify({ guestId, exp: Date.now() + VOTER_SESSION_TTL_MS });
  const encoded = Buffer.from(payload, "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/** Returns the guestId this token is bound to if the signature is valid and it hasn't expired, else null. */
export function getVerifiedGuestId(token: string | undefined | null): string | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expectedSignature = sign(encoded);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as {
      guestId: string;
      exp: number;
    };
    return payload.exp > Date.now() ? payload.guestId : null;
  } catch {
    return null;
  }
}

/**
 * The single source of truth for "who is making this request" on the
 * voting page: the guestId bound to a valid session cookie, or null if
 * there isn't one. Never derived from anything client-supplied (a request
 * body, a query param, sessionStorage) — callers that need to know the
 * current voter's identity must read it from here, not trust the caller
 * to say who they are.
 */
export async function getSessionGuestId(): Promise<string | null> {
  const token = (await cookies()).get(VOTER_SESSION_COOKIE)?.value;
  return getVerifiedGuestId(token);
}
