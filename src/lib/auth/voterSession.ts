import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { getDataStore } from "@/lib/data-access";
import { currentSessionEpoch, isSessionRevoked } from "./sessionRevocation";

export const VOTER_SESSION_COOKIE = "tn_voter_session";
const VOTER_SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours — long enough to cover a full party night
export const VOTER_SESSION_MAX_AGE_SECONDS = VOTER_SESSION_TTL_MS / 1000;

export interface VoterSessionEntry {
  guestId: string;
  exp: number;
  /** This guest's session-revocation epoch at mint time — see sessionRevocation.ts. A logout bumps the guest's current epoch, which immediately invalidates every entry minted before it, even one never resubmitted until now. */
  epoch: number;
  /** Random per-mint value with no behavioral meaning of its own — guarantees two tokens for the same guest are never byte-identical, even when minted in the same millisecond. */
  jti: string;
  /**
   * When this entry was minted (ms since epoch) — compared against
   * DataStore.getSessionsInvalidBefore() (see applySessionsResetFilter
   * below) so the admin's "Remove all login sessions" action can
   * invalidate every non-admin session ever minted before it ran, even one
   * that was never resubmitted until long after. Defaults to 0 (the oldest
   * possible value) for a session minted before this field existed, or
   * carried in a pre-multi-session legacy cookie — same conservative
   * "when in doubt, re-verify" posture the rest of this file already takes
   * for upgrades.
   */
  iat: number;
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
 * Verifies the token's signature and prunes any expired or revoked (see
 * sessionRevocation.ts — e.g. a logout since this token was minted) session
 * entries, or returns null if the token is missing/invalid. Same
 * HMAC-signed-cookie construction as passkeyChallenge.ts, reusing
 * SESSION_SECRET — the distinct cookie name and payload shape already
 * prevent any cross-use between the two.
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
      // Predates epoch/jti — epoch 0 is the oldest possible value, so this
      // is correctly revoked the moment this guest ever logs out even once
      // post-upgrade, same conservative "when in doubt, re-verify" posture
      // the rest of this upgrade path already takes.
      if (legacy.exp <= now || isSessionRevoked(legacy.guestId, 0)) {
        return { sessions: [], activeGuestId: "" };
      }
      return {
        sessions: [{ guestId: legacy.guestId, exp: legacy.exp, epoch: 0, jti: "", iat: 0 }],
        activeGuestId: legacy.guestId,
      };
    }

    const sessions = (raw as VoterSessionPayload).sessions
      .map((s) => ({
        ...s,
        epoch: typeof s.epoch === "number" ? s.epoch : 0,
        jti: s.jti ?? "",
        iat: typeof s.iat === "number" ? s.iat : 0,
      }))
      .filter((s) => s.exp > now && !isSessionRevoked(s.guestId, s.epoch));
    return { sessions, activeGuestId: (raw as VoterSessionPayload).activeGuestId };
  } catch {
    return null;
  }
}

/**
 * Drops any session entry minted before DataStore.getSessionsInvalidBefore()
 * — the admin's "Remove all login sessions" action (see /admin/security's
 * Danger Zone) — unless that entry's guest is an admin. Short-circuits to
 * avoid any Sheets read at all when there's nothing to filter (the common
 * case): an empty session list, or no mass reset ever triggered. Even when
 * a reset *has* happened, a session minted after it (every normal case,
 * once guests re-verify) still skips the guest-list read entirely — only a
 * session that actually predates the reset pays for it, to check whether
 * its guest is exempt.
 *
 * The sessionsInvalidBefore read is always fresh (never the 10s Sheets read
 * cache) since this must take effect immediately; the guest-list read (for
 * the admin exemption) uses the normal cached path — admin status changes
 * rarely, and admin *access* itself is independently re-verified fresh by
 * isAdminRequest() wherever it actually matters, so a few seconds of
 * staleness here only affects how promptly a demoted admin's own session
 * gets swept up in a reset, not any real authorization boundary.
 */
async function applySessionsResetFilter(payload: VoterSessionPayload | null): Promise<VoterSessionPayload | null> {
  if (!payload || payload.sessions.length === 0) return payload;
  const store = getDataStore();
  const sessionsInvalidBefore = await store.getSessionsInvalidBefore();
  if (sessionsInvalidBefore === null) return payload;

  const possiblyRevoked = payload.sessions.some((s) => s.iat < sessionsInvalidBefore);
  if (!possiblyRevoked) return payload;

  const guests = await store.getGuests();
  const isAdminGuest = (guestId: string) => guests.find((g) => g.id === guestId)?.isAdmin === true;
  const sessions = payload.sessions.filter((s) => s.iat >= sessionsInvalidBefore || isAdminGuest(s.guestId));
  if (sessions.length === payload.sessions.length) return payload;

  const activeGuestId = sessions.some((s) => s.guestId === payload.activeGuestId)
    ? payload.activeGuestId
    : (sessions[0]?.guestId ?? "");
  return { sessions, activeGuestId };
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
  return applySessionsResetFilter(decode(token));
}

/**
 * Pure variant of getSessionGuestId that resolves from an already-read
 * cookie value instead of calling next/headers' cookies() itself — used by
 * proxy.ts (see src/proxy.ts), which only has NextRequest's own cookie
 * accessor; next/headers' request-scoped cookies() isn't available that
 * early in the request lifecycle. Deliberately does NOT apply
 * applySessionsResetFilter (that needs async Sheets reads) — proxy.ts
 * applies the equivalent check itself via resolveActiveSessionEntry below,
 * reusing the guest it already fetches for the pendingApprovalAt check
 * rather than paying for a second guest read here.
 */
export function resolveSessionGuestId(token: string | undefined | null): string | null {
  const payload = decode(token);
  if (!payload) return null;
  const active = payload.sessions.find((s) => s.guestId === payload.activeGuestId);
  return active ? active.guestId : null;
}

/**
 * Like resolveSessionGuestId, but returns the full active session entry
 * (including `iat`) rather than just the guestId — proxy.ts uses this to
 * apply the sessions-reset check (see applySessionsResetFilter) without
 * needing the async cookies() API, since it only has NextRequest's own
 * synchronous cookie accessor at the point it runs.
 */
export function resolveActiveSessionEntry(token: string | undefined | null): VoterSessionEntry | null {
  const payload = decode(token);
  if (!payload) return null;
  return payload.sessions.find((s) => s.guestId === payload.activeGuestId) ?? null;
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
  const sessions = [
    ...kept,
    {
      guestId,
      exp: Date.now() + VOTER_SESSION_TTL_MS,
      epoch: currentSessionEpoch(guestId),
      jti: crypto.randomBytes(16).toString("hex"),
      iat: Date.now(),
    },
  ];
  return encode({ sessions, activeGuestId: guestId });
}
