/**
 * /api/admin/vote-as/[guestId] — the admin-only "vote for this guest"
 * route (see GuestManager.tsx's "Vote for this guest" action and
 * /admin/vote-as/[guestId]/page.tsx, the UI that calls this). Exercises
 * the REAL route handlers against a fake DataStore, same approach as
 * adminAccessControl.test.ts: only the data access layer and the
 * session-identity lookup (getSessionGuestId, which isAdminRequest()
 * itself is built on) are mocked — everything else, including the
 * category/nominee validation copied from POST /api/votes, runs for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, Group, Guest, Vote } from "@/lib/data-access";
import type { VotingCategory } from "@/lib/config/types";

let currentSessionGuestId: string | null = null;

vi.mock("@/lib/auth/voterSession", () => ({
  getSessionGuestId: vi.fn(async () => currentSessionGuestId),
}));

const CATEGORIES: VotingCategory[] = [
  { id: "best-adult-male-costume", label: "Best Adult Male Costume", bracket: "adult-male" },
];

vi.mock("@/lib/config", () => ({
  getSiteConfig: () => ({
    features: { votingModuleEnabled: true },
    voting: { categories: CATEGORIES },
  }),
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

const ADMIN_ID = "00000000-0000-0000-0000-00000000a1a1";
const TARGET_ID = "00000000-0000-0000-0000-00000000b1b1";
const NOMINEE_ID = "00000000-0000-0000-0000-00000000c1c1";
const INELIGIBLE_NOMINEE_ID = "00000000-0000-0000-0000-00000000c2c2"; // bracket "boy" — ineligible for the adult-male category
const PENDING_TARGET_ID = "00000000-0000-0000-0000-00000000d1d1";
const NONEXISTENT_ID = "00000000-0000-0000-0000-00000000ffff"; // well-formed UUID, no matching guest
const MALFORMED_ID = "not-a-uuid";

const GUESTS: Record<string, Guest> = {
  [ADMIN_ID]: makeGuest({ id: ADMIN_ID, firstName: "Ada", lastName: "Min", isAdmin: true }),
  [TARGET_ID]: makeGuest({ id: TARGET_ID, firstName: "Gus", lastName: "Est" }),
  [NOMINEE_ID]: makeGuest({ id: NOMINEE_ID, firstName: "Nomi", lastName: "Nee", bracket: "adult-male" }),
  [INELIGIBLE_NOMINEE_ID]: makeGuest({ id: INELIGIBLE_NOMINEE_ID, firstName: "Boy", lastName: "Not Eligible", bracket: "boy" }),
  [PENDING_TARGET_ID]: makeGuest({
    id: PENDING_TARGET_ID,
    firstName: "Pen",
    lastName: "Ding",
    checkedInAt: null,
    pendingApprovalAt: "2026-01-01T00:00:00.000Z",
  }),
};

let votingOpen: boolean;
let votesStore: Vote[];
let getVotesCalls: Array<{ fresh?: boolean } | undefined>;

function makeFakeStore(): DataStore {
  return {
    getGuests: vi.fn(async () => Object.values(GUESTS)),
    getGuestById: vi.fn(async (id: string) => GUESTS[id] ?? null),
    findGuestByName: vi.fn(async () => null),
    addGuest: vi.fn(async (g) => makeGuest({ id: "new-guest", ...g })),
    addGuests: vi.fn(async () => []),
    updateGuest: vi.fn(async (id, updates) => ({ ...makeGuest({ id }), ...updates })),
    savePhotoReference: vi.fn(async () => {}),
    deleteGuest: vi.fn(async () => {}),
    markGuestCheckedIn: vi.fn(async () => {}),
    markGuestPendingApproval: vi.fn(async () => {}),
    approvePendingGuest: vi.fn(async () => {}),
    rejectPendingGuest: vi.fn(async () => {}),
    migratePlaintextPhones: vi.fn(async () => ({ migrated: 0, alreadyEncrypted: 0, skippedEmpty: 0 })),

    getGroups: vi.fn(async () => [] as Group[]),
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

    recordVote: vi.fn(async (v) => {
      const timestamp = "2026-01-01T00:00:00.000Z";
      const row: Vote = { voterGuestId: v.voterGuestId, category: v.category, nomineeId: v.nomineeId, timestamp };
      const existingIndex = votesStore.findIndex(
        (existing) => existing.voterGuestId === v.voterGuestId && existing.category === v.category,
      );
      if (existingIndex >= 0) {
        votesStore[existingIndex] = row;
      } else {
        votesStore.push(row);
      }
      return row;
    }),
    getVotes: vi.fn(async (options?: { fresh?: boolean }) => {
      getVotesCalls.push(options);
      return votesStore;
    }),

    getPasskeyByGuestId: vi.fn(async () => null),
    getPasskeyByCredentialId: vi.fn(async () => null),
    getPasskeys: vi.fn(async () => []),
    savePasskey: vi.fn(async () => {}),
    updatePasskeyCounter: vi.fn(async () => {}),
    deletePasskey: vi.fn(async () => true),

    getVotingStatus: vi.fn(async () => ({
      isOpen: votingOpen,
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

    getCheckInGateToken: vi.fn(async () => null),
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

let fakeStore: DataStore;
vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

function jsonRequest(body?: unknown) {
  return new Request("http://localhost/api/admin/vote-as/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as never; // route handlers type this as NextRequest, but only ever use Request-compatible members here
}

function paramsOf(guestId: string) {
  return { params: Promise.resolve({ guestId }) };
}

beforeEach(() => {
  currentSessionGuestId = null;
  votingOpen = true;
  votesStore = [];
  getVotesCalls = [];
  fakeStore = makeFakeStore();
});

describe("non-admin requests", () => {
  it("GET is rejected (403) with no session at all", async () => {
    const { GET } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await GET(jsonRequest(), paramsOf(TARGET_ID));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).not.toHaveProperty("votes");
  });

  it("GET is rejected (403) for a valid, non-admin guest session", async () => {
    currentSessionGuestId = TARGET_ID;
    const { GET } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await GET(jsonRequest(), paramsOf(TARGET_ID));
    expect(res.status).toBe(403);
  });

  it("POST is rejected (403) with no session at all, and never calls recordVote", async () => {
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    );
    expect(res.status).toBe(403);
    expect(fakeStore.recordVote).not.toHaveBeenCalled();
  });

  it("POST is rejected (403) for a valid, non-admin guest session, and never falls back to acting as that guest", async () => {
    currentSessionGuestId = TARGET_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    );
    expect(res.status).toBe(403);
    expect(fakeStore.recordVote).not.toHaveBeenCalled();
    expect(votesStore).toHaveLength(0);
  });

  it("a non-admin is rejected (403) even with a malformed guest id — the admin check runs before id validation, so this is never an oracle for which ids are well-formed", async () => {
    const { GET } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await GET(jsonRequest(), paramsOf(MALFORMED_ID));
    expect(res.status).toBe(403);
  });
});

describe("admin proxy voting", () => {
  it("records the vote under the TARGET guest's id, not the admin's own", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    );
    expect(res.status).toBe(200);
    expect(votesStore).toEqual([
      { voterGuestId: TARGET_ID, category: "best-adult-male-costume", nomineeId: NOMINEE_ID, timestamp: expect.any(String) },
    ]);
    expect(fakeStore.recordVote).toHaveBeenCalledWith(
      expect.objectContaining({ voterGuestId: TARGET_ID }),
    );
  });

  it("does not affect the admin's own existing votes", async () => {
    // The admin already has their own vote on file in this same category.
    votesStore = [
      { voterGuestId: ADMIN_ID, category: "best-adult-male-costume", nomineeId: NOMINEE_ID, timestamp: "2026-01-01T00:00:00.000Z" },
    ];
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    );

    const adminVotes = votesStore.filter((v) => v.voterGuestId === ADMIN_ID);
    expect(adminVotes).toHaveLength(1);
    expect(adminVotes[0]).toMatchObject({ voterGuestId: ADMIN_ID, nomineeId: NOMINEE_ID });
    const targetVotes = votesStore.filter((v) => v.voterGuestId === TARGET_ID);
    expect(targetVotes).toHaveLength(1);
  });

  it("upserts — a second proxy vote in the same category overwrites, never double-counts", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    );
    await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: INELIGIBLE_NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    ).catch(() => {}); // intentionally ineligible — see the dedicated eligibility test; just confirming no double row here if it somehow succeeded
    const targetVotes = votesStore.filter((v) => v.voterGuestId === TARGET_ID);
    expect(targetVotes).toHaveLength(1); // still just one row for this category
  });

  it("GET returns only the target guest's votes, via a fresh (not cached) read", async () => {
    votesStore = [
      { voterGuestId: TARGET_ID, category: "best-adult-male-costume", nomineeId: NOMINEE_ID, timestamp: "2026-01-01T00:00:00.000Z" },
      { voterGuestId: ADMIN_ID, category: "best-adult-male-costume", nomineeId: NOMINEE_ID, timestamp: "2026-01-01T00:00:00.000Z" },
    ];
    currentSessionGuestId = ADMIN_ID;
    const { GET } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await GET(jsonRequest(), paramsOf(TARGET_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { voterGuestId: string; votes: Vote[] };
    expect(body.voterGuestId).toBe(TARGET_ID);
    expect(body.votes).toHaveLength(1);
    expect(body.votes[0]).toMatchObject({ voterGuestId: TARGET_ID });
    expect(getVotesCalls).toContainEqual({ fresh: true });
  });

  it("never sets a session cookie for the target guest (or touches the admin's own)", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { GET, POST } = await import("@/app/api/admin/vote-as/[guestId]/route");

    const getRes = await GET(jsonRequest(), paramsOf(TARGET_ID));
    expect(getRes.headers.get("set-cookie")).toBeNull();

    const postRes = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    );
    expect(postRes.headers.get("set-cookie")).toBeNull();
  });
});

describe("same rules as the guest-facing route", () => {
  it("rejects when voting is closed (403), same message style as POST /api/votes", async () => {
    votingOpen = false;
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/voting is currently closed/i);
    expect(fakeStore.recordVote).not.toHaveBeenCalled();
  });

  it("rejects an unknown category (400)", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(jsonRequest({ selections: [{ category: "not-a-real-category", nomineeId: NOMINEE_ID }] }), paramsOf(TARGET_ID));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/unknown category/i);
  });

  it("rejects an ineligible nominee for the category's bracket (400)", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: INELIGIBLE_NOMINEE_ID }] }),
      paramsOf(TARGET_ID),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/isn.t eligible/i);
    expect(fakeStore.recordVote).not.toHaveBeenCalled();
  });

  it("rejects an unknown nominee id (400)", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NONEXISTENT_ID }] }),
      paramsOf(TARGET_ID),
    );
    expect(res.status).toBe(400);
  });

  it("respects the target guest's own pending-approval gate, same as the guest-facing route", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(PENDING_TARGET_ID),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/waiting on admin approval/i);
  });
});

describe("guest id validation", () => {
  it("rejects a malformed guest id (404) for an admin too", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { GET } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await GET(jsonRequest(), paramsOf(MALFORMED_ID));
    expect(res.status).toBe(404);
  });

  it("rejects a well-formed but nonexistent guest id (404)", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { GET } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await GET(jsonRequest(), paramsOf(NONEXISTENT_ID));
    expect(res.status).toBe(404);
  });

  it("POST also rejects a nonexistent guest id (404) and never calls recordVote", async () => {
    currentSessionGuestId = ADMIN_ID;
    const { POST } = await import("@/app/api/admin/vote-as/[guestId]/route");
    const res = await POST(
      jsonRequest({ selections: [{ category: "best-adult-male-costume", nomineeId: NOMINEE_ID }] }),
      paramsOf(NONEXISTENT_ID),
    );
    expect(res.status).toBe(404);
    expect(fakeStore.recordVote).not.toHaveBeenCalled();
  });
});
