import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

export const VOTER_SESSION_COOKIE = "tn_voter_session";
const VOTER_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours — long enough to cover a full party night
export const VOTER_SESSION_MAX_AGE_SECONDS = VOTER_SESSION_TTL_MS / 1000;

interface VoterSessionEntry {
  guestId: string;
  exp: number;
}

interface VoterSessionPayload {
  /** Every guest who has verified on this browser and hasn't expired yet — not just the current one. */
  sessions: VoterSessionEntry[];
  /** Which of `sessions` is "you" right now for browsing/voting. */
  activeGuestId: string;
}

/** The single-guest-per-browser cookie shape used before multi-session support. See decode()'s upgrade path below. */
interface LegacyVoterSessionPayload {
  guestId: string;
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

function encode(payload: VoterSessionPayload): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

/**
 * Verifies the token's signature and prunes any expired session entries,
 * or returns null if the token is missing/invalid. Mirrors
 * adminSession.ts's HMAC-signed-cookie pattern, reusing SESSION_SECRET —
 * the distinct cookie name and payload shape already prevent any cross-use
 * between admin and voter tokens.
 *
 * Transparently upgrades cookies signed before multi-session support (a
 * flat `{guestId, exp}`, one guest per browser) into the current shape.
 * Without this, a guest who verified under the old format would have their
 * still-valid cookie silently read as "no session at all" the moment this
 * shape changed — forcing an unnecessary re-verification the first time
 * they were checked, which is exactly the bug this upgrade path prevents.
 */
function decode(token: string | undefined | null): VoterSessionPayload | null {
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
    const raw = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as
      | VoterSessionPayload
      | LegacyVoterSessionPayload;
    const now = Date.now();

    if (!Array.isArray((raw as VoterSessionPayload).sessions)) {
      const legacy = raw as LegacyVoterSessionPayload;
      if (typeof legacy.guestId !== "string" || typeof legacy.exp !== "number") {
        return { sessions: [], activeGuestId: "" };
      }
      if (legacy.exp <= now) return { sessions: [], activeGuestId: "" };
      return { sessions: [{ guestId: legacy.guestId, exp: legacy.exp }], activeGuestId: legacy.guestId };
    }

    const sessions = (raw as VoterSessionPayload).sessions.filter((s) => s.exp > now);
    return { sessions, activeGuestId: (raw as VoterSessionPayload).activeGuestId };
  } catch {
    return null;
  }
}

/**
 * Reads and validates the current request's session payload, or null if
 * there isn't one. A browser can hold more than one guest's verified
 * session at once — e.g. a parent and a child verifying on the same shared
 * device over the course of the night — so this is the raw session list,
 * not just "the" current identity (see getSessionGuestId for that).
 */
export async function getVoterSessionPayload(): Promise<VoterSessionPayload | null> {
  const token = (await cookies()).get(VOTER_SESSION_COOKIE)?.value;
  return decode(token);
}

/**
 * The single source of truth for "who is making this request" on the
 * voting page: the guestId of the currently-active session, or null if
 * there isn't one. Never derived from anything client-supplied (a request
 * body, a query param, sessionStorage) — callers that need to know the
 * current voter's identity must read it from here, not trust the caller
 * to say who they are.
 */
export async function getSessionGuestId(): Promise<string | null> {
  const payload = await getVoterSessionPayload();
  if (!payload) return null;
  const active = payload.sessions.find((s) => s.guestId === payload.activeGuestId);
  return active ? active.guestId : null;
}

/** True if guestId already has a still-valid (unexpired) session in payload — the "Not you?" no-reverification fast path. */
export function hasSessionFor(payload: VoterSessionPayload | null, guestId: string): boolean {
  return !!payload?.sessions.some((s) => s.guestId === guestId);
}

/**
 * Switches the active session to guestId without touching any other
 * session in payload. Callers must have already confirmed guestId is
 * present via hasSessionFor — this doesn't check.
 */
export function switchActiveSessionToken(payload: VoterSessionPayload, guestId: string): string {
  return encode({ sessions: payload.sessions, activeGuestId: guestId });
}

/**
 * Builds a new token after a fresh phone verification: adds (or refreshes,
 * if re-verifying) guestId's session, keeps every other still-valid
 * session already in currentPayload untouched (so verifying as a second
 * guest on the same device doesn't sign the first one out), and makes
 * guestId the active session.
 */
export function createVoterSessionToken(currentPayload: VoterSessionPayload | null, guestId: string): string {
  const kept = (currentPayload?.sessions ?? []).filter((s) => s.guestId !== guestId);
  const sessions = [...kept, { guestId, exp: Date.now() + VOTER_SESSION_TTL_MS }];
  return encode({ sessions, activeGuestId: guestId });
}
