/**
 * Exercises the REAL session machinery (not a mock of it) — voterSession.ts,
 * sessionRevocation.ts, adminAccess.ts, and a representative slice of the
 * actual route handlers — to audit/harden session handling for both guest
 * and admin sessions. Only two things are mocked: the data access layer (so
 * this never touches the real Google Sheet) and next/headers' cookies()
 * (so a test can simulate a browser's cookie jar across several simulated
 * "requests" without a real HTTP server).
 *
 * Admin here is not a separate login — it's just whatever guest the active
 * session's guestId resolves to, re-checked fresh against the Guests sheet
 * on every call (see adminAccess.ts) — so "a guest session escalated to an
 * admin session" only has one possible attack surface: forging or replaying
 * a session cookie. That's what most of this file targets.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, Guest, NewGuest } from "@/lib/data-access";

let cookieJar: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
  })),
}));

function makeGuest(overrides: Partial<Guest>): Guest {
  return {
    id: "unset",
    firstName: "Test",
    lastName: "Guest",
    bracket: "adult-male",
    photoRef: null,
    photoUrl: null,
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    groupId: null,
    phone: null,
    checkedInAt: "2026-01-01T00:00:00.000Z",
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

const GUESTS: Record<string, Guest> = {
  "admin-1": makeGuest({ id: "admin-1", firstName: "Ada", lastName: "Min", isAdmin: true }),
  "guest-1": makeGuest({ id: "guest-1", firstName: "Gus", lastName: "Est" }),
  "guest-2": makeGuest({ id: "guest-2", firstName: "Gia", lastName: "Est" }),
  "pending-1": makeGuest({ id: "pending-1", firstName: "Pen", lastName: "Ding", checkedInAt: null, pendingApprovalAt: "2026-01-01T00:00:00.000Z" }),
};

function makeFakeStore(): DataStore {
  return {
    getGuests: vi.fn(async () => Object.values(GUESTS)),
    getGuestById: vi.fn(async (id: string) => GUESTS[id] ?? null),
    findGuestByName: vi.fn(async () => null),
    addGuest: vi.fn(async (g) => makeGuest({ id: "new-guest", ...g })),
    addGuests: vi.fn(async (gs: NewGuest[]) => gs.map((g, i) => makeGuest({ id: `new-guest-${i}`, ...g }))),
    updateGuest: vi.fn(async (id, updates) => makeGuest({ id, ...updates })),
    savePhotoReference: vi.fn(async () => {}),
    deleteGuest: vi.fn(async () => {}),
    markGuestCheckedIn: vi.fn(async () => {}),
    markGuestPendingApproval: vi.fn(async () => {}),
    approvePendingGuest: vi.fn(async () => {}),
    rejectPendingGuest: vi.fn(async () => {}),
    migratePlaintextPhones: vi.fn(async () => ({ migrated: 0, alreadyEncrypted: 0, skippedEmpty: 0 })),

    getGroups: vi.fn(async () => []),
    getGroupById: vi.fn(async () => null),
    addGroup: vi.fn(async (g) => ({ id: "group-1", name: g.name, photoRef: null, photoUrl: null, memberIds: [g.creatorGuestId], createdAt: "2026-01-01T00:00:00.000Z" })),
    addGuestToGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    removeGuestFromGroup: vi.fn(async () => {}),
    updateGroup: vi.fn(async (id, updates) => ({ id, name: updates.name ?? "", photoRef: null, photoUrl: null, memberIds: [], createdAt: "2026-01-01T00:00:00.000Z" })),
    deleteGroup: vi.fn(async () => {}),
    saveGroupPhotoReference: vi.fn(async () => {}),

    recordVote: vi.fn(async (v) => ({ ...v, timestamp: "2026-01-01T00:00:00.000Z" })),
    getVotes: vi.fn(async () => []),

    getPasskeyByGuestId: vi.fn(async () => null),
    getPasskeyByCredentialId: vi.fn(async () => null),
    savePasskey: vi.fn(async () => {}),
    updatePasskeyCounter: vi.fn(async () => {}),

    getVotingStatus: vi.fn(async () => ({
      isOpen: true,
      resultsPublished: false,
      phoneVerificationEnabled: false,
      passkeyAuthEnabled: true,
      selfServiceWalkinEnabled: true,
    })),
    setVotingOpen: vi.fn(async () => {}),
    setResultsPublished: vi.fn(async () => {}),
    setPhoneVerificationEnabled: vi.fn(async () => {}),
    setPasskeyAuthEnabled: vi.fn(async () => {}),
    setSelfServiceWalkinEnabled: vi.fn(async () => {}),

    recordCandyGuess: vi.fn(async (g) => ({ ...g, timestamp: "2026-01-01T00:00:00.000Z" })),
    getCandyGuesses: vi.fn(async () => []),
    getCandyGuessByGuestId: vi.fn(async () => null),

    getCandyCountStatus: vi.fn(async () => ({ guessingOpen: true, resultsPublished: false, trueCount: null })),
    setCandyGuessingOpen: vi.fn(async () => {}),
    setCandyResultsPublished: vi.fn(async () => {}),
    setCandyTrueCount: vi.fn(async () => {}),
  };
}

let fakeStore: DataStore;

vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as never; // route handlers type this as NextRequest, but only ever use Request-compatible members here
}

function paramsOf<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

/** Tampers with a validly-signed token's payload while keeping the original signature, simulating forgery without SESSION_SECRET. */
function tamperPayload(token: string, mutate: (payload: Record<string, unknown>) => void): string {
  const [encoded, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf-8"));
  mutate(payload);
  const tamperedEncoded = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${tamperedEncoded}.${signature}`;
}

beforeEach(() => {
  cookieJar = {};
  fakeStore = makeFakeStore();
});

describe("Token generation", () => {
  it("never reuses a token across two sessions minted for the same guest, even at the same instant", async () => {
    const { createVoterSessionToken } = await import("@/lib/auth/voterSession");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T20:00:00.000Z"));
    const tokenA = createVoterSessionToken(null, "fresh-guest-a");
    const tokenB = createVoterSessionToken(null, "fresh-guest-a");
    vi.useRealTimers();
    expect(tokenA).not.toBe(tokenB);
  });

  it("produces a signature that can't be reproduced without SESSION_SECRET (a tampered guestId is rejected)", async () => {
    const { createVoterSessionToken, resolveSessionGuestId } = await import("@/lib/auth/voterSession");
    const token = createVoterSessionToken(null, "tamper-guest");
    const forged = tamperPayload(token, (payload) => {
      const sessions = payload.sessions as Array<Record<string, unknown>>;
      sessions[0]!.guestId = "admin-1";
      payload.activeGuestId = "admin-1";
    });
    expect(resolveSessionGuestId(forged)).toBeNull();
  });
});

describe("Token lifetime and replay", () => {
  it("rejects an expired token", async () => {
    const { createVoterSessionToken, resolveSessionGuestId, VOTER_SESSION_MAX_AGE_SECONDS } = await import(
      "@/lib/auth/voterSession"
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T20:00:00.000Z"));
    const token = createVoterSessionToken(null, "expiry-guest");
    expect(resolveSessionGuestId(token)).toBe("expiry-guest");

    vi.setSystemTime(new Date(Date.now() + VOTER_SESSION_MAX_AGE_SECONDS * 1000 + 1000));
    expect(resolveSessionGuestId(token)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects a replayed token after logout, even though the attacker's copy was never cleared", async () => {
    const { createVoterSessionToken, resolveSessionGuestId } = await import("@/lib/auth/voterSession");
    const { POST: logout } = await import("@/app/api/auth/phone/logout/route");

    const stolenToken = createVoterSessionToken(null, "replay-guest");
    expect(resolveSessionGuestId(stolenToken)).toBe("replay-guest");

    // The legitimate browser logs out...
    cookieJar.tn_voter_session = stolenToken;
    await logout();

    // ...and the attacker's copy of the pre-logout token, kept separately
    // and never touched by the browser's own cookie clear, must still be
    // dead — this is server-side revocation, not a client-side forget.
    expect(resolveSessionGuestId(stolenToken)).toBeNull();
  });

  it("lets the same guest get a working fresh session after logging out", async () => {
    const { createVoterSessionToken, resolveSessionGuestId } = await import("@/lib/auth/voterSession");
    const { POST: logout } = await import("@/app/api/auth/phone/logout/route");

    const oldToken = createVoterSessionToken(null, "relogin-guest");
    cookieJar.tn_voter_session = oldToken;
    await logout();
    expect(resolveSessionGuestId(oldToken)).toBeNull();

    const freshToken = createVoterSessionToken(null, "relogin-guest");
    expect(freshToken).not.toBe(oldToken);
    expect(resolveSessionGuestId(freshToken)).toBe("relogin-guest");
  });

  it("logout revokes every identity the browser was holding, not just the active one", async () => {
    const { createVoterSessionToken, getVoterSessionPayload, resolveSessionGuestId, hasSessionFor } = await import(
      "@/lib/auth/voterSession"
    );
    const { POST: logout } = await import("@/app/api/auth/phone/logout/route");

    const tokenA = createVoterSessionToken(null, "multi-guest-a");
    cookieJar.tn_voter_session = tokenA;
    const payloadWithA = await getVoterSessionPayload();
    const tokenAB = createVoterSessionToken(payloadWithA, "multi-guest-b"); // now active, A still kept
    cookieJar.tn_voter_session = tokenAB;

    const payload = await getVoterSessionPayload();
    expect(hasSessionFor(payload, "multi-guest-a")).toBe(true);
    expect(hasSessionFor(payload, "multi-guest-b")).toBe(true);

    await logout();

    expect(resolveSessionGuestId(tokenAB)).toBeNull(); // multi-guest-b, the active one
    const { getVoterSessionPayload: getPayloadAgain } = await import("@/lib/auth/voterSession");
    cookieJar.tn_voter_session = tokenAB;
    const payloadAfter = await getPayloadAgain();
    expect(hasSessionFor(payloadAfter, "multi-guest-a")).toBe(false); // the inactive one too
  });
});

describe("No cross-role escalation between a guest session and an admin session", () => {
  it("isAdminRequest() reflects only the active session's own admin flag, never an inactive co-session's", async () => {
    const { createVoterSessionToken, getVoterSessionPayload, switchActiveSessionToken } = await import(
      "@/lib/auth/voterSession"
    );
    const { isAdminRequest } = await import("@/lib/auth/adminAccess");

    cookieJar.tn_voter_session = createVoterSessionToken(null, "guest-1");
    const payloadGuestOnly = await getVoterSessionPayload();
    cookieJar.tn_voter_session = createVoterSessionToken(payloadGuestOnly, "admin-1"); // admin-1 now active
    expect(await isAdminRequest()).toBe(true);

    // Switch the active identity back to the non-admin guest on the same
    // browser — admin-1's still-valid session is still present, but must
    // never grant admin access while a non-admin is active.
    const payloadBoth = await getVoterSessionPayload();
    if (!payloadBoth) throw new Error("expected both sessions to still be present");
    cookieJar.tn_voter_session = switchActiveSessionToken(payloadBoth, "guest-1");
    expect(await isAdminRequest()).toBe(false);
  });

  it("a guest-session token is rejected on every admin-only route sampled (check-in, voting-status, delete guest), and an admin session is allowed", async () => {
    const { createVoterSessionToken } = await import("@/lib/auth/voterSession");
    const { POST: checkIn } = await import("@/app/api/admin/check-in/route");
    const { POST: votingStatus } = await import("@/app/api/admin/voting-status/route");
    const { DELETE: deleteGuest } = await import("@/app/api/guests/[id]/route");

    const cases = [
      {
        label: "POST /api/admin/check-in",
        call: () =>
          checkIn(jsonRequest("http://localhost/api/admin/check-in", "POST", { guestId: "pending-1", action: "approve" })),
      },
      {
        label: "POST /api/admin/voting-status",
        call: () => votingStatus(jsonRequest("http://localhost/api/admin/voting-status", "POST", { isOpen: true })),
      },
      {
        label: "DELETE /api/guests/[id]",
        call: () => deleteGuest(jsonRequest("http://localhost/api/guests/guest-2", "DELETE"), paramsOf({ id: "guest-2" })),
      },
    ];

    for (const c of cases) {
      cookieJar = {}; // unauthenticated
      let res = await c.call();
      expect(res.status, `${c.label} with no session`).toBe(401);

      cookieJar.tn_voter_session = createVoterSessionToken(null, "guest-1"); // real, valid, non-admin
      res = await c.call();
      expect(res.status, `${c.label} with a valid guest session`).toBe(401);

      cookieJar.tn_voter_session = createVoterSessionToken(null, "admin-1"); // real, valid, admin
      res = await c.call();
      expect(res.status, `${c.label} with a valid admin session`).not.toBe(401);
    }
  });
});

describe("Cookie storage", () => {
  it("sets the session cookie httpOnly and SameSite=Lax, never exposed to client-readable storage", async () => {
    const { createVoterSessionToken, getVoterSessionPayload } = await import("@/lib/auth/voterSession");
    const { POST: activate } = await import("@/app/api/auth/phone/activate/route");

    cookieJar.tn_voter_session = createVoterSessionToken(null, "cookie-attrs-guest");
    const payload = await getVoterSessionPayload();
    void payload; // sanity that the token above actually decodes before we rely on activate's "Not you?" fast path

    const res = await activate(jsonRequest("http://localhost/api/auth/phone/activate", "POST", { guestId: "cookie-attrs-guest" }));
    const body = await res.json();
    expect(body.switched).toBe(true);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });
});
