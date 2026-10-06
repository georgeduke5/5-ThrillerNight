/**
 * Enforces one-passkey-per-guest server-side at every layer the audit was
 * asked to check:
 *
 * 1. GoogleSheetsDataStore.savePasskey itself (no route involved) — the
 *    last-resort backstop so a challenge issued before another
 *    registration can't complete afterward even if every route-level
 *    check somehow raced past it.
 * 2. POST /api/auth/passkey/begin — a guest with an existing passkey is
 *    always offered authentication, never registration.
 * 3. POST /api/auth/passkey/finish — handleRegistration's own check,
 *    re-verified right before the write, independent of whatever /begin
 *    decided.
 * 4. The admin-only removal action (DELETE /api/guests/[id]/passkey) that
 *    is the only way to clear the rule, including its session-revocation
 *    side effect.
 *
 * Only @simplewebauthn/server (the native ceremony itself, meaningless to
 * simulate for real) and next/headers (so a challenge cookie can travel
 * between a begin call and its matching finish call, the same way a real
 * browser round-trip would carry it) are mocked. voterSession.ts,
 * passkeyChallenge.ts, adminAccess.ts, and sessionRevocation.ts all run
 * for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DataStore, Guest, GuestPasskey, NewGuest } from "@/lib/data-access";
import { PublicError } from "@/lib/errors";

let cookieJar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
  })),
}));

let credentialCounter = 0;
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: `reg-challenge-${Math.random()}`,
    rp: { id: "x", name: "x" },
    user: {},
  })),
  generateAuthenticationOptions: vi.fn(async () => ({
    challenge: `auth-challenge-${Math.random()}`,
    allowCredentials: [],
  })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: {
        id: `new-cred-${credentialCounter++}`,
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: [],
      },
    },
  })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
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
    checkedInAt: null,
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

const ADMIN_ID = "00000000-0000-0000-0000-00000000a1a1";
const CHILD1_ID = "00000000-0000-0000-0000-00000000c001";
const CHILD2_ID = "00000000-0000-0000-0000-00000000c002";
const PARENT_ID = "00000000-0000-0000-0000-00000000c003";

let currentSessionGuestId: string | null;
let guestsById: Map<string, Guest>;
let passkeysByGuestId: Map<string, GuestPasskey>;
let fakeStore: DataStore;

vi.mock("@/lib/auth/voterSession", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/voterSession")>("@/lib/auth/voterSession");
  return {
    ...actual,
    getSessionGuestId: vi.fn(async () => currentSessionGuestId),
  };
});

vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

function makeFakeStore(): DataStore {
  return {
    getGuests: vi.fn(async () => [...guestsById.values()]),
    getGuestById: vi.fn(async (id: string) => guestsById.get(id) ?? null),
    findGuestByName: vi.fn(async () => null),
    addGuest: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    addGuests: vi.fn(async (gs: NewGuest[]) => gs.map((g, i) => makeGuest({ id: `new-guest-${i}`, ...g }))),
    updateGuest: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    savePhotoReference: vi.fn(async () => {}),
    deleteGuest: vi.fn(async () => {}),
    markGuestCheckedIn: vi.fn(async () => {}),
    markGuestPendingApproval: vi.fn(async () => {}),
    approvePendingGuest: vi.fn(async () => {}),
    rejectPendingGuest: vi.fn(async () => {}),
    migratePlaintextPhones: vi.fn(async () => ({ migrated: 0, alreadyEncrypted: 0, skippedEmpty: 0 })),

    getGroups: vi.fn(async () => []),
    getGroupById: vi.fn(async () => null),
    addGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    addGuestToGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    removeGuestFromGroup: vi.fn(async () => {}),
    updateGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    deleteGroup: vi.fn(async () => {}),
    saveGroupPhotoReference: vi.fn(async () => {}),

    recordVote: vi.fn(async (v) => ({ ...v, timestamp: "2026-01-01T00:00:00.000Z" })),
    getVotes: vi.fn(async () => []),

    getPasskeyByGuestId: vi.fn(async (guestId: string) => passkeysByGuestId.get(guestId) ?? null),
    getPasskeyByCredentialId: vi.fn(async (credentialId: string) => {
      for (const pk of passkeysByGuestId.values()) {
        if (pk.credentialId === credentialId) return pk;
      }
      return null;
    }),
    getPasskeys: vi.fn(async () => [...passkeysByGuestId.values()]),
    // Mirrors GoogleSheetsDataStore's own real enforcement (tested directly,
    // without any route, in the describe block further down) so the route
    // tests here exercise realistic store behavior, not a store that always
    // just says yes.
    savePasskey: vi.fn(async (passkey: GuestPasskey) => {
      if (passkeysByGuestId.has(passkey.guestId)) {
        throw new PublicError("This guest already has a passkey registered.");
      }
      passkeysByGuestId.set(passkey.guestId, passkey);
    }),
    deletePasskey: vi.fn(async (guestId: string) => passkeysByGuestId.delete(guestId)),
    updatePasskeyCounter: vi.fn(async (guestId: string, counter: number) => {
      const existing = passkeysByGuestId.get(guestId);
      if (existing) passkeysByGuestId.set(guestId, { ...existing, counter });
    }),

    getVotingStatus: vi.fn(async () => ({
      isOpen: true,
      resultsPublished: false,
      phoneVerificationEnabled: false,
      passkeyAuthEnabled: true,
      selfServiceWalkinEnabled: true,
      inPersonCheckInEnabled: true,
    })),
    setVotingOpen: vi.fn(async () => {}),
    setResultsPublished: vi.fn(async () => {}),
    setPhoneVerificationEnabled: vi.fn(async () => {}),
    setPasskeyAuthEnabled: vi.fn(async () => {}),
    setSelfServiceWalkinEnabled: vi.fn(async () => {}),
    setInPersonCheckInEnabled: vi.fn(async () => {}),

    recordCandyGuess: vi.fn(async (g) => ({ ...g, timestamp: "2026-01-01T00:00:00.000Z" })),
    getCandyGuesses: vi.fn(async () => []),
    getCandyGuessByGuestId: vi.fn(async () => null),

    getCandyCountStatus: vi.fn(async () => ({ guessingOpen: true, resultsPublished: false, trueCount: null })),
    setCandyGuessingOpen: vi.fn(async () => {}),
    setCandyResultsPublished: vi.fn(async () => {}),
    setCandyTrueCount: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  cookieJar = {};
  currentSessionGuestId = null;
  guestsById = new Map([
    [ADMIN_ID, makeGuest({ id: ADMIN_ID, firstName: "Ada", lastName: "Min", isAdmin: true })],
    [CHILD1_ID, makeGuest({ id: CHILD1_ID, firstName: "Carter", lastName: "Duke" })],
    [CHILD2_ID, makeGuest({ id: CHILD2_ID, firstName: "Casey", lastName: "Duke" })],
    [PARENT_ID, makeGuest({ id: PARENT_ID, firstName: "Pat", lastName: "Duke" })],
  ]);
  passkeysByGuestId = new Map();
  fakeStore = makeFakeStore();
});

/** A real NextRequest (not a plain Request) — resolvePasskeyRelyingParty reads request.nextUrl, which only NextRequest provides. */
function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function paramsOf<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

/** Runs a full begin -> finish registration ceremony for guestId, propagating the challenge (and voter-session) cookie between the two calls the way a real browser round-trip would. Returns the finish response. */
async function registerPasskey(guestId: string) {
  const { POST: begin } = await import("@/app/api/auth/passkey/begin/route");
  const beginRes = await begin(jsonRequest("http://localhost/api/auth/passkey/begin", "POST", { guestId }));
  const beginBody = await beginRes.json();
  if (beginBody.mode !== "registration") {
    return { beginBody, finishRes: null, finishBody: null };
  }
  cookieJar.tn_passkey_challenge = beginRes.headers
    .getSetCookie()
    .find((c) => c.startsWith("tn_passkey_challenge="))!
    .split(";")[0]!
    .split("=")
    .slice(1)
    .join("=");

  const { POST: finish } = await import("@/app/api/auth/passkey/finish/route");
  const finishRes = await finish(
    jsonRequest("http://localhost/api/auth/passkey/finish", "POST", { response: { id: "whatever" } }),
  );
  const finishBody = await finishRes.json().catch(() => null);
  const voterCookie = finishRes.headers.getSetCookie().find((c) => c.startsWith("tn_voter_session="));
  if (voterCookie) {
    cookieJar.tn_voter_session = voterCookie.split(";")[0]!.split("=").slice(1).join("=");
  }
  return { beginBody, finishRes, finishBody };
}

describe("POST /api/auth/passkey/begin — a guest with an existing passkey is always offered authentication", () => {
  it("offers registration for a guest with none", async () => {
    const { beginBody } = await registerPasskey(CHILD1_ID);
    expect(beginBody.mode).toBe("registration");
  });

  it("offers authentication (never registration) for a guest who already has one, with no session on the browser", async () => {
    passkeysByGuestId.set(CHILD1_ID, {
      guestId: CHILD1_ID,
      credentialId: "existing-cred",
      publicKey: "pk",
      counter: 0,
      transports: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    currentSessionGuestId = null;
    const { POST: begin } = await import("@/app/api/auth/passkey/begin/route");
    const res = await begin(jsonRequest("http://localhost/api/auth/passkey/begin", "POST", { guestId: CHILD1_ID }));
    const body = await res.json();
    expect(body.mode).toBe("authentication");
  });

  it("offers authentication (never registration) for a guest who already has one, even with an unrelated session active", async () => {
    passkeysByGuestId.set(CHILD1_ID, {
      guestId: CHILD1_ID,
      credentialId: "existing-cred",
      publicKey: "pk",
      counter: 0,
      transports: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    currentSessionGuestId = PARENT_ID; // someone else entirely is active on this browser
    const { POST: begin } = await import("@/app/api/auth/passkey/begin/route");
    const res = await begin(jsonRequest("http://localhost/api/auth/passkey/begin", "POST", { guestId: CHILD1_ID }));
    const body = await res.json();
    expect(body.mode).toBe("authentication");
  });
});

describe("POST /api/auth/passkey/finish — rejects registration for a guest who already has a passkey", () => {
  it("rejects when the challenge was issued for a genuine first-time registration but another one completed before this finish call", async () => {
    // Mint a registration challenge for a guest with no passkey yet...
    const { POST: begin } = await import("@/app/api/auth/passkey/begin/route");
    const beginRes = await begin(jsonRequest("http://localhost/api/auth/passkey/begin", "POST", { guestId: CHILD1_ID }));
    const beginBody = await beginRes.json();
    expect(beginBody.mode).toBe("registration");
    cookieJar.tn_passkey_challenge = beginRes.headers
      .getSetCookie()
      .find((c) => c.startsWith("tn_passkey_challenge="))!
      .split(";")[0]!
      .split("=")
      .slice(1)
      .join("=");

    // ...but a DIFFERENT registration for the same guest (e.g. a second tab,
    // or a race) completes first.
    passkeysByGuestId.set(CHILD1_ID, {
      guestId: CHILD1_ID,
      credentialId: "won-the-race",
      publicKey: "pk",
      counter: 0,
      transports: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    // The original challenge, issued before that race was decided, must not
    // be able to complete now.
    const { POST: finish } = await import("@/app/api/auth/passkey/finish/route");
    const finishRes = await finish(
      jsonRequest("http://localhost/api/auth/passkey/finish", "POST", { response: { id: "whatever" } }),
    );
    expect(finishRes.status).toBe(401);
    const finishBody = await finishRes.json();
    expect(finishBody.error).toMatch(/already has a passkey/i);
    // The race winner's credential must be the one left standing.
    expect(passkeysByGuestId.get(CHILD1_ID)?.credentialId).toBe("won-the-race");
  });

  it("with no session and with an unrelated session active, a pre-existing passkey still blocks a forged registration-ceremony finish", async () => {
    passkeysByGuestId.set(CHILD1_ID, {
      guestId: CHILD1_ID,
      credentialId: "existing-cred",
      publicKey: "pk",
      counter: 0,
      transports: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    for (const session of [null, PARENT_ID]) {
      currentSessionGuestId = session;
      // begin() for this guest now only ever issues an authentication
      // challenge (see the describe block above) — finish's own
      // independent check is what's under test here, so a registration
      // challenge is crafted directly via the real, signed cookie encoder
      // rather than relying on begin to produce one it no longer would.
      const { encodePasskeyChallenge } = await import("@/lib/auth/passkeyChallenge");
      cookieJar.tn_passkey_challenge = encodePasskeyChallenge({
        guestId: CHILD1_ID,
        challenge: "forged-registration-challenge",
        ceremony: "registration",
      });

      const { POST: finish } = await import("@/app/api/auth/passkey/finish/route");
      const finishRes = await finish(
        jsonRequest("http://localhost/api/auth/passkey/finish", "POST", { response: { id: "whatever" } }),
      );
      expect(finishRes.status).toBe(401);
      const finishBody = await finishRes.json();
      expect(finishBody.error).toMatch(/already has a passkey/i);
    }
  });
});

describe("A parent and two children on one device can each register their own passkey via switch identity", () => {
  it("three independent guests each complete registration on the same browser, none blocking the others", async () => {
    const r1 = await registerPasskey(CHILD1_ID);
    expect(r1.beginBody.mode).toBe("registration");
    expect(r1.finishRes?.status).toBe(200);

    const r2 = await registerPasskey(CHILD2_ID);
    expect(r2.beginBody.mode).toBe("registration");
    expect(r2.finishRes?.status).toBe(200);

    const r3 = await registerPasskey(PARENT_ID);
    expect(r3.beginBody.mode).toBe("registration");
    expect(r3.finishRes?.status).toBe(200);

    expect(passkeysByGuestId.has(CHILD1_ID)).toBe(true);
    expect(passkeysByGuestId.has(CHILD2_ID)).toBe(true);
    expect(passkeysByGuestId.has(PARENT_ID)).toBe(true);
    // Each guest's own credential — never collapsed into one shared row.
    const ids = new Set([...passkeysByGuestId.values()].map((pk) => pk.credentialId));
    expect(ids.size).toBe(3);

    // The shared voter-session cookie now holds all three — "switch
    // identity" merges rather than replaces (see voterSession.ts).
    const { resolveSessionGuestId, hasSessionFor, getVoterSessionPayload } = await import(
      "@/lib/auth/voterSession"
    );
    const activeGuestId = resolveSessionGuestId(cookieJar.tn_voter_session);
    expect(activeGuestId).toBe(PARENT_ID); // the most recently completed
    const finalPayload = await getVoterSessionPayload();
    expect(hasSessionFor(finalPayload, CHILD1_ID)).toBe(true);
    expect(hasSessionFor(finalPayload, CHILD2_ID)).toBe(true);
    expect(hasSessionFor(finalPayload, PARENT_ID)).toBe(true);
  });
});

describe("DELETE /api/guests/[id]/passkey — admin-only removal, re-enables registration, revokes sessions", () => {
  beforeEach(async () => {
    passkeysByGuestId.set(CHILD1_ID, {
      guestId: CHILD1_ID,
      credentialId: "existing-cred",
      publicKey: "pk",
      counter: 0,
      transports: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("rejects an unauthenticated request", async () => {
    currentSessionGuestId = null;
    const { DELETE } = await import("@/app/api/guests/[id]/passkey/route");
    const res = await DELETE(jsonRequest("http://localhost/api/guests/x/passkey", "DELETE"), paramsOf({ id: CHILD1_ID }));
    expect(res.status).toBe(401);
    expect(passkeysByGuestId.has(CHILD1_ID)).toBe(true);
  });

  it("rejects a valid non-admin guest session", async () => {
    currentSessionGuestId = PARENT_ID;
    const { DELETE } = await import("@/app/api/guests/[id]/passkey/route");
    const res = await DELETE(jsonRequest("http://localhost/api/guests/x/passkey", "DELETE"), paramsOf({ id: CHILD1_ID }));
    expect(res.status).toBe(401);
    expect(passkeysByGuestId.has(CHILD1_ID)).toBe(true);
  });

  it("an admin session can remove it, which re-enables registration and revokes the guest's sessions", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { currentSessionEpoch } = await import("@/lib/auth/sessionRevocation");
    const epochBefore = currentSessionEpoch(CHILD1_ID);

    const { DELETE } = await import("@/app/api/guests/[id]/passkey/route");
    const res = await DELETE(jsonRequest("http://localhost/api/guests/x/passkey", "DELETE"), paramsOf({ id: CHILD1_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(true);
    expect(passkeysByGuestId.has(CHILD1_ID)).toBe(false);

    // Any session this guest held is now revoked.
    const epochAfter = currentSessionEpoch(CHILD1_ID);
    expect(epochAfter).toBeGreaterThan(epochBefore);

    // Registration is open again.
    currentSessionGuestId = null;
    const { POST: begin } = await import("@/app/api/auth/passkey/begin/route");
    const beginRes = await begin(jsonRequest("http://localhost/api/auth/passkey/begin", "POST", { guestId: CHILD1_ID }));
    const beginBody = await beginRes.json();
    expect(beginBody.mode).toBe("registration");
  });

  it("is a harmless no-op (still ok) for a guest who has no passkey", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { DELETE } = await import("@/app/api/guests/[id]/passkey/route");
    const res = await DELETE(
      jsonRequest("http://localhost/api/guests/x/passkey", "DELETE"),
      paramsOf({ id: CHILD2_ID }), // never had one
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removed).toBe(false);
  });
});
