/**
 * Server-side enforcement for the check-in flow's admin toggles
 * (VotingStatus.passkeyAuthEnabled / inPersonCheckInEnabled): each route
 * must reject when its toggle is off, and the zero-methods-enabled
 * auto-check-in path (POST /api/auth/auto-check-in) must succeed ONLY when
 * every method is off — it's the one route that can complete a check-in
 * with no proof of identity at all, so a single enabled method must be
 * enough to block it. Every request in this file carries a valid
 * party-presence gate cookie by default (see checkInGate.test.ts for that
 * gate's own coverage) so these tests isolate the *method* toggles, not the
 * gate.
 *
 * Real route handlers, real voterSession.ts. Only the data-access layer
 * (so this never touches a real Sheet) and next/headers' cookies() are
 * mocked — nothing left in this file touches Twilio.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, Guest, VotingStatus } from "@/lib/data-access";

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
    checkedInAt: null,
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

const ALL_ENABLED: VotingStatus = {
  isOpen: true,
  resultsPublished: false,
  phoneVerificationEnabled: true,
  passkeyAuthEnabled: true,
  selfServiceWalkinEnabled: true,
  inPersonCheckInEnabled: true,
};

const GUEST_ID = "00000000-0000-0000-0000-00000000001a";
const PENDING_ID = "00000000-0000-0000-0000-00000000001b";
/** Stands in for an admin-generated party-presence token — see checkInGate.ts. Not what this file is testing; just a precondition several of these routes now share. */
const TEST_GATE_TOKEN = "test-gate-token";

let votingStatus: VotingStatus;
let guests: Record<string, Guest>;
let fakeStore: DataStore;

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
    markGuestCheckedIn: vi.fn(async (id: string) => {
      guests[id] = makeGuest({ ...guests[id], checkedInAt: "2026-10-06T20:00:00.000Z" });
    }),
    markGuestPendingApproval: vi.fn(async (id: string) => {
      const g = guests[id];
      if (!g || g.checkedInAt || g.pendingApprovalAt) return;
      guests[id] = makeGuest({ ...g, pendingApprovalAt: "2026-10-06T20:00:00.000Z" });
    }),
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

    getCheckInGateToken: vi.fn(async () => TEST_GATE_TOKEN),
    setCheckInGateToken: vi.fn(async () => {}),

    clearVotesAndCandyGuesses: vi.fn(async () => ({ votesCleared: 0, guessesCleared: 0 })),
    deleteNonAdminPasskeys: vi.fn(async () => ({ deleted: 0, guestIds: [] })),
    getSessionsInvalidBefore: vi.fn(async () => null),
    setSessionsInvalidBefore: vi.fn(async () => {}),
    setAllSessionsInvalidBefore: vi.fn(async () => {}),
    getSessionInvalidationThresholds: vi.fn(async () => ({ sessionsInvalidBefore: null, allSessionsInvalidBefore: null })),
    resetToAdminsOnly: vi.fn(async () => ({
      guestsDeleted: 0,
      adminsKept: 0,
      votesCleared: 0,
      guessesCleared: 0,
      passkeysCleared: 0,
      allGuestIds: [],
    })),
  };
}

vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

function jsonRequest(url: string, body?: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as never; // route handlers type this as NextRequest, but only use Request-compatible members here
}

beforeEach(() => {
  cookieJar = { tn_checkin_gate: TEST_GATE_TOKEN };
  votingStatus = { ...ALL_ENABLED };
  guests = {
    [GUEST_ID]: makeGuest({ id: GUEST_ID, firstName: "Gus", lastName: "Est" }),
    [PENDING_ID]: makeGuest({
      id: PENDING_ID,
      firstName: "Pen",
      lastName: "Ding",
      pendingApprovalAt: "2026-01-01T00:00:00.000Z",
    }),
  };
  fakeStore = makeFakeStore();
});

describe("POST /api/auth/auto-check-in — the zero-methods-enabled path", () => {
  it.each([
    ["passkeyAuthEnabled"],
    ["phoneVerificationEnabled"],
    ["inPersonCheckInEnabled"],
  ] as const)("rejects when only %s is enabled, so it can never bypass a still-required method", async (toggle) => {
    votingStatus = {
      ...ALL_ENABLED,
      passkeyAuthEnabled: false,
      phoneVerificationEnabled: false,
      inPersonCheckInEnabled: false,
      [toggle]: true,
    };
    const { POST } = await import("@/app/api/auth/auto-check-in/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/auto-check-in", { guestId: GUEST_ID }));
    expect(res.status).toBe(403);
    expect(fakeStore.markGuestCheckedIn).not.toHaveBeenCalled();
  });

  it("succeeds only when ALL three methods are off, and checks the guest in", async () => {
    votingStatus = {
      ...ALL_ENABLED,
      passkeyAuthEnabled: false,
      phoneVerificationEnabled: false,
      inPersonCheckInEnabled: false,
    };
    const { POST } = await import("@/app/api/auth/auto-check-in/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/auto-check-in", { guestId: GUEST_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(fakeStore.markGuestCheckedIn).toHaveBeenCalledWith(GUEST_ID);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
  });

  it("never downgrades a guest who is already pending via a different path", async () => {
    votingStatus = {
      ...ALL_ENABLED,
      passkeyAuthEnabled: false,
      phoneVerificationEnabled: false,
      inPersonCheckInEnabled: false,
    };
    const { POST } = await import("@/app/api/auth/auto-check-in/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/auto-check-in", { guestId: PENDING_ID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingApproval).toBe(true);
    expect(fakeStore.markGuestCheckedIn).not.toHaveBeenCalled();
  });

  it("rejects an invalid guestId with 400 before even reading the toggles", async () => {
    const { POST } = await import("@/app/api/auth/auto-check-in/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/auto-check-in", { guestId: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("404s for a guest that doesn't exist, even with every method off", async () => {
    votingStatus = {
      ...ALL_ENABLED,
      passkeyAuthEnabled: false,
      phoneVerificationEnabled: false,
      inPersonCheckInEnabled: false,
    };
    const { POST } = await import("@/app/api/auth/auto-check-in/route");
    const res = await POST(
      jsonRequest("http://localhost/api/auth/auto-check-in", { guestId: "00000000-0000-0000-0000-00000000dead" }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects with 403 when the party-presence gate isn't open, even with every method off", async () => {
    cookieJar = {}; // no tn_checkin_gate cookie at all this time
    votingStatus = {
      ...ALL_ENABLED,
      passkeyAuthEnabled: false,
      phoneVerificationEnabled: false,
      inPersonCheckInEnabled: false,
    };
    const { POST } = await import("@/app/api/auth/auto-check-in/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/auto-check-in", { guestId: GUEST_ID }));
    expect(res.status).toBe(403);
    expect(fakeStore.markGuestCheckedIn).not.toHaveBeenCalled();
  });
});

describe("In-Person method rejects server-side when disabled", () => {
  it("POST /api/auth/passkey/fallback/give-up rejects with 403 when inPersonCheckInEnabled is off, even if passkeyAuthEnabled is on", async () => {
    votingStatus = { ...ALL_ENABLED, inPersonCheckInEnabled: false, passkeyAuthEnabled: true };
    const { POST } = await import("@/app/api/auth/passkey/fallback/give-up/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/fallback/give-up", { guestId: GUEST_ID }));
    expect(res.status).toBe(403);
    expect(fakeStore.markGuestPendingApproval).not.toHaveBeenCalled();
  });

  it("POST /api/auth/passkey/fallback/give-up is unaffected by passkeyAuthEnabled being off — the two methods are independent", async () => {
    votingStatus = { ...ALL_ENABLED, inPersonCheckInEnabled: true, passkeyAuthEnabled: false };
    const { POST } = await import("@/app/api/auth/passkey/fallback/give-up/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/fallback/give-up", { guestId: GUEST_ID }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/passkey/fallback/give-up only ever files a pending request", () => {
  const APPROVED_ID = "00000000-0000-0000-0000-00000000001c";

  beforeEach(() => {
    guests[APPROVED_ID] = makeGuest({
      id: APPROVED_ID,
      firstName: "Al",
      lastName: "Ready",
      checkedInAt: "2026-10-06T19:00:00.000Z",
    });
  });

  it("refuses an already-approved guest and issues no session — picking their name must never grant their access", async () => {
    const { POST } = await import("@/app/api/auth/passkey/fallback/give-up/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/fallback/give-up", { guestId: APPROVED_ID }));
    expect(res.status).toBe(409);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("tn_voter_session");
    expect(fakeStore.markGuestPendingApproval).not.toHaveBeenCalled();
  });

  it("refuses to attach this browser to someone else's already-pending request", async () => {
    const { POST } = await import("@/app/api/auth/passkey/fallback/give-up/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/fallback/give-up", { guestId: PENDING_ID }));
    expect(res.status).toBe(409);
    expect(res.headers.get("set-cookie") ?? "").not.toContain("tn_voter_session");
  });

  it("marks a guest with no prior status pending and reports pendingApproval — never checks them in", async () => {
    const { POST } = await import("@/app/api/auth/passkey/fallback/give-up/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/fallback/give-up", { guestId: GUEST_ID }));
    expect(res.status).toBe(200);
    expect((await res.json()).pendingApproval).toBe(true);
    expect(fakeStore.markGuestPendingApproval).toHaveBeenCalledWith(GUEST_ID);
    expect(fakeStore.markGuestCheckedIn).not.toHaveBeenCalled();
    expect(guests[GUEST_ID]?.pendingApprovalAt).not.toBeNull();
    expect(guests[GUEST_ID]?.checkedInAt).toBeNull();
  });

  it("rejects without the party-presence gate cookie", async () => {
    cookieJar = {};
    const { POST } = await import("@/app/api/auth/passkey/fallback/give-up/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/fallback/give-up", { guestId: GUEST_ID }));
    expect(res.status).toBe(403);
    expect(fakeStore.markGuestPendingApproval).not.toHaveBeenCalled();
  });
});

describe("hasFullCheckInAccess — the allow-list every participation surface uses", () => {
  it("is true only for a checked-in, non-pending guest", async () => {
    const { hasFullCheckInAccess } = await import("@/lib/auth/guestStatus");
    expect(hasFullCheckInAccess({ checkedInAt: "x", pendingApprovalAt: null })).toBe(true);
    expect(hasFullCheckInAccess({ checkedInAt: null, pendingApprovalAt: "x" })).toBe(false);
    // "none" — e.g. an admin rejected the pending request
    expect(hasFullCheckInAccess({ checkedInAt: null, pendingApprovalAt: null })).toBe(false);
    expect(hasFullCheckInAccess({ checkedInAt: "x", pendingApprovalAt: "x" })).toBe(false);
  });
});
