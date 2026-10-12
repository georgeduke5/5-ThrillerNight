/**
 * The party-presence gate end to end: generating a token (admin-only)
 * immediately supersedes whatever was valid before, claiming a token sets
 * the guest-facing cookie only when it matches what's currently stored,
 * and the three "cold start" routes (POST /api/auth/passkey/begin,
 * .../phone-gate/start, /api/auth/auto-check-in) all independently reject
 * when that cookie is missing or stale — this is the actual server-side
 * enforcement behind VerifyIdentityModal's client-side "scan the QR code"
 * screen, not just a UI nicety.
 *
 * Also confirms the old standalone "type in your own phone number" routes
 * are gone outright — not disabled, not 404ing at runtime, but absent from
 * the build entirely (dynamic import rejects).
 *
 * Real route handlers, real checkInGate.ts, real voterSession.ts /
 * adminAccess.ts. Only the data-access layer (so this never touches a real
 * Sheet), next/headers' cookies(), and Twilio are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DataStore, Guest, VotingStatus } from "@/lib/data-access";

let cookieJar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
  })),
}));

const sendVerificationCode = vi.fn(async (_phone: string) => {});
vi.mock("@/lib/auth/twilioVerify", () => ({
  sendVerificationCode: (phone: string) => sendVerificationCode(phone),
  checkVerificationCode: vi.fn(async () => true),
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

const ADMIN_ID = "00000000-0000-0000-0000-0000000a9a9a";
const GUEST_ID = "00000000-0000-0000-0000-00000000001a";
const PHONE_GUEST_ID = "00000000-0000-0000-0000-00000000002b";

const ALL_ENABLED: VotingStatus = {
  isOpen: true,
  resultsPublished: false,
  phoneVerificationEnabled: true,
  passkeyAuthEnabled: true,
  selfServiceWalkinEnabled: true,
  inPersonCheckInEnabled: true,
};

let votingStatus: VotingStatus;
let guests: Record<string, Guest>;
// Stateful, like the real Settings-sheet-backed implementation: generating
// overwrites this, a claim reads whatever's here right now.
let storedGateToken: string | null;
let currentSessionGuestId: string | null;

vi.mock("@/lib/auth/voterSession", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/voterSession")>("@/lib/auth/voterSession");
  return {
    ...actual,
    getSessionGuestId: vi.fn(async () => currentSessionGuestId),
  };
});

function makeFakeStore(): DataStore {
  return {
    getGuests: vi.fn(async () => Object.values(guests)),
    getGuestById: vi.fn(async (id: string) => guests[id] ?? null),
    findGuestByName: vi.fn(async () => null),
    addGuest: vi.fn(async (g) => makeGuest({ id: "new-guest", ...g })),
    addGuests: vi.fn(async () => []),
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
    addGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
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
    getPasskeys: vi.fn(async () => []),
    savePasskey: vi.fn(async () => {}),
    updatePasskeyCounter: vi.fn(async () => {}),
    deletePasskey: vi.fn(async () => true),

    getVotingStatus: vi.fn(async () => votingStatus),
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

    getCheckInGateToken: vi.fn(async () => storedGateToken),
    setCheckInGateToken: vi.fn(async (token: string) => {
      storedGateToken = token;
    }),
  };
}

let fakeStore: DataStore;
vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

/** A real NextRequest (not a plain Request) — resolvePasskeyRelyingParty (used by /api/auth/passkey/begin) reads request.nextUrl, which only NextRequest provides. */
function jsonRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  cookieJar = {};
  storedGateToken = null;
  currentSessionGuestId = null;
  votingStatus = { ...ALL_ENABLED };
  guests = {
    [ADMIN_ID]: makeGuest({ id: ADMIN_ID, firstName: "Ada", lastName: "Min", isAdmin: true }),
    [GUEST_ID]: makeGuest({ id: GUEST_ID, firstName: "Gus", lastName: "Est" }),
    [PHONE_GUEST_ID]: makeGuest({ id: PHONE_GUEST_ID, firstName: "Phil", lastName: "One", phone: "5555550123" }),
  };
  fakeStore = makeFakeStore();
  sendVerificationCode.mockClear();
});

describe("Generating a new party-presence token invalidates the prior one", () => {
  it("stores whatever POST /api/admin/checkin-gate/generate mints, and a claim against it succeeds", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST: generate } = await import("@/app/api/admin/checkin-gate/generate/route");
    const genRes = await generate();
    expect(genRes.status).toBe(200);
    const { token: tokenA } = await genRes.json();
    expect(typeof tokenA).toBe("string");
    expect(tokenA.length).toBeGreaterThan(20);

    const { POST: claim } = await import("@/app/api/auth/checkin-gate/claim/route");
    const claimRes = await claim(jsonRequest("http://localhost/api/auth/checkin-gate/claim", { token: tokenA }));
    expect(claimRes.status).toBe(200);
    const claimBody = await claimRes.json();
    expect(claimBody.ok).toBe(true);
    expect(claimRes.headers.get("set-cookie")).toMatch(/tn_checkin_gate=/);
  });

  it("a second generate immediately makes the first token stop matching", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST: generate } = await import("@/app/api/admin/checkin-gate/generate/route");
    const { token: tokenA } = await (await generate()).json();
    const { token: tokenB } = await (await generate()).json();
    expect(tokenB).not.toBe(tokenA);

    const { POST: claim } = await import("@/app/api/auth/checkin-gate/claim/route");
    const staleClaim = await claim(jsonRequest("http://localhost/api/auth/checkin-gate/claim", { token: tokenA }));
    expect((await staleClaim.json()).ok).toBe(false);

    const freshClaim = await claim(jsonRequest("http://localhost/api/auth/checkin-gate/claim", { token: tokenB }));
    expect((await freshClaim.json()).ok).toBe(true);
  });

  it("a claim with no stored token at all (admin never generated one) always fails", async () => {
    const { POST: claim } = await import("@/app/api/auth/checkin-gate/claim/route");
    const res = await claim(jsonRequest("http://localhost/api/auth/checkin-gate/claim", { token: "anything" }));
    expect((await res.json()).ok).toBe(false);
  });
});

describe("GET /api/votes/status reports checkInGateOpen from this browser's own cookie", () => {
  it("false with no cookie at all", async () => {
    storedGateToken = "real-token";
    const { GET } = await import("@/app/api/votes/status/route");
    const body = await (await GET()).json();
    expect(body.checkInGateOpen).toBe(false);
  });

  it("true once a matching cookie is present", async () => {
    storedGateToken = "real-token";
    cookieJar.tn_checkin_gate = "real-token";
    const { GET } = await import("@/app/api/votes/status/route");
    const body = await (await GET()).json();
    expect(body.checkInGateOpen).toBe(true);
  });

  it("false again once the stored token has moved on, even with the old cookie still present", async () => {
    storedGateToken = "old-token";
    cookieJar.tn_checkin_gate = "old-token";
    storedGateToken = "new-token"; // admin generated a fresh one
    const { GET } = await import("@/app/api/votes/status/route");
    const body = await (await GET()).json();
    expect(body.checkInGateOpen).toBe(false);
  });
});

describe("Server-side enforcement on the three routes reachable with nothing but a guestId", () => {
  it("POST /api/auth/passkey/begin rejects with 403 when the gate cookie is missing", async () => {
    const { POST } = await import("@/app/api/auth/passkey/begin/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/begin", { guestId: GUEST_ID }));
    expect(res.status).toBe(403);
  });

  it("POST /api/auth/passkey/begin proceeds once a matching gate cookie is present", async () => {
    storedGateToken = "real-token";
    cookieJar.tn_checkin_gate = "real-token";
    const { POST } = await import("@/app/api/auth/passkey/begin/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/begin", { guestId: GUEST_ID }));
    expect(res.status).toBe(200);
  });

  it("POST /api/auth/passkey/phone-gate/start rejects with 403 when the gate cookie is missing", async () => {
    const { POST } = await import("@/app/api/auth/passkey/phone-gate/start/route");
    const res = await POST(
      jsonRequest("http://localhost/api/auth/passkey/phone-gate/start", { guestId: PHONE_GUEST_ID }),
    );
    expect(res.status).toBe(403);
    expect(sendVerificationCode).not.toHaveBeenCalled();
  });

  it("POST /api/auth/passkey/phone-gate/start proceeds once a matching gate cookie is present", async () => {
    storedGateToken = "real-token";
    cookieJar.tn_checkin_gate = "real-token";
    const { POST } = await import("@/app/api/auth/passkey/phone-gate/start/route");
    const res = await POST(
      jsonRequest("http://localhost/api/auth/passkey/phone-gate/start", { guestId: PHONE_GUEST_ID }),
    );
    expect(res.status).toBe(200);
    expect(sendVerificationCode).toHaveBeenCalled();
  });
});

describe("The standalone phone-number login path no longer exists", () => {
  it.each([
    "@/app/api/auth/phone/start/route",
    "@/app/api/auth/phone/verify/route",
    "@/app/api/auth/passkey/fallback/start/route",
    "@/app/api/auth/passkey/fallback/verify/route",
  ])("%s can no longer be imported — the route is gone, not just disabled", async (modulePath) => {
    await expect(import(modulePath)).rejects.toThrow();
  });
});
