/**
 * Exercises the REAL route handlers (not a re-implementation of their
 * logic) for every admin-only action in the app, confirming each
 * independently checks isAdminRequest() server-side before doing anything
 * privileged — regardless of what a client claims, hides, or guesses.
 *
 * Only two things are mocked: the data access layer (so this never touches
 * the real Google Sheet / Drive) and the session-identity lookup
 * (getSessionGuestId) that isAdminRequest() itself is built on. Everything
 * else — isAdminRequest() itself, the route handlers, their validation —
 * runs for real. "Session" here just means setting `currentSessionGuestId`
 * before a call; the fake data store's getGuestById is what makes that id
 * resolve to an admin or a non-admin guest.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataStore, Group, Guest, NewGuest } from "@/lib/data-access";

let currentSessionGuestId: string | null = null;

vi.mock("@/lib/auth/voterSession", () => ({
  VOTER_SESSION_COOKIE: "tn_voter_session",
  VOTER_SESSION_MAX_AGE_SECONDS: 43200,
  getSessionGuestId: vi.fn(async () => currentSessionGuestId),
  getVoterSessionPayload: vi.fn(async () => null),
  resolveSessionGuestId: vi.fn(() => null),
  hasSessionFor: vi.fn(() => false),
  createVoterSessionToken: vi.fn(() => "mock-session-token"),
  switchActiveSessionToken: vi.fn(() => "mock-session-token"),
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
  "00000000-0000-0000-0000-00000000a1a1": makeGuest({ id: "00000000-0000-0000-0000-00000000a1a1", firstName: "Ada", lastName: "Min", isAdmin: true, phone: "5555550100" }),
  "00000000-0000-0000-0000-00000000b1b1": makeGuest({ id: "00000000-0000-0000-0000-00000000b1b1", firstName: "Gus", lastName: "Est" }),
  "00000000-0000-0000-0000-00000000b2b2": makeGuest({ id: "00000000-0000-0000-0000-00000000b2b2", firstName: "Gia", lastName: "Est" }),
  "00000000-0000-0000-0000-00000000c1c1": makeGuest({ id: "00000000-0000-0000-0000-00000000c1c1", firstName: "Pen", lastName: "Ding", checkedInAt: null, pendingApprovalAt: "2026-01-01T00:00:00.000Z" }),
};

const FAKE_GROUP: Group = {
  id: "00000000-0000-0000-0000-00000000d1d1",
  name: "Fake Group",
  photoRef: null,
  photoUrl: null,
  memberIds: ["00000000-0000-0000-0000-00000000b1b1"],
  createdAt: "2026-01-01T00:00:00.000Z",
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

    getGroups: vi.fn(async () => [FAKE_GROUP]),
    getGroupById: vi.fn(async (id: string) => (id === "00000000-0000-0000-0000-00000000d1d1" ? FAKE_GROUP : null)),
    addGroup: vi.fn(async (g) => ({ ...FAKE_GROUP, name: g.name })),
    addGuestToGroup: vi.fn(async () => FAKE_GROUP),
    removeGuestFromGroup: vi.fn(async () => {}),
    updateGroup: vi.fn(async (id, updates) => ({ ...FAKE_GROUP, id, ...updates })),
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

vi.mock("@/lib/photo-storage", () => ({
  getPhotoStorage: () => ({
    uploadPhoto: vi.fn(async () => ({ ref: "fake-photo-ref", url: "https://example.com/fake.jpg" })),
    deletePhoto: vi.fn(async () => {}),
  }),
}));

beforeEach(() => {
  currentSessionGuestId = null;
  fakeStore = makeFakeStore();
});

// A minimal, real JPEG (just the signature bytes imageSniff.ts looks for)
// so POST /api/photos' content-sniffing step — unrelated to this file's
// subject, but upstream of the admin check in that route — never blocks
// these tests before the auth check even runs.
const TINY_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);

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

type RouteCase = {
  label: string;
  call: () => Promise<Response>;
  /** Status a *successful* admin call should return. */
  successStatus: number;
};

function expectRejectsNonAdmin(c: RouteCase) {
  it(`${c.label}: rejects an unauthenticated request (401)`, async () => {
    currentSessionGuestId = null;
    const res = await c.call();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).not.toHaveProperty("guests");
    expect(body).not.toHaveProperty("results");
  });

  it(`${c.label}: rejects a valid non-admin guest session (401)`, async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b1b1";
    const res = await c.call();
    expect(res.status).toBe(401);
  });

  it(`${c.label}: allows a valid admin session`, async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000a1a1";
    const res = await c.call();
    expect(res.status).toBe(c.successStatus);
  });
}

describe("Strictly admin-only routes", () => {
  describe("POST /api/admin/check-in", () => {
    const call = async () => {
      const { POST } = await import("@/app/api/admin/check-in/route");
      return POST(jsonRequest("http://localhost/api/admin/check-in", "POST", { guestId: "00000000-0000-0000-0000-00000000c1c1", action: "approve" }));
    };
    expectRejectsNonAdmin({ label: "POST /api/admin/check-in", call, successStatus: 200 });
  });

  describe("POST /api/admin/voting-status", () => {
    const call = async () => {
      const { POST } = await import("@/app/api/admin/voting-status/route");
      return POST(jsonRequest("http://localhost/api/admin/voting-status", "POST", { isOpen: true }));
    };
    expectRejectsNonAdmin({ label: "POST /api/admin/voting-status", call, successStatus: 200 });
  });

  describe("POST /api/admin/candy-count-status", () => {
    const call = async () => {
      const { POST } = await import("@/app/api/admin/candy-count-status/route");
      return POST(jsonRequest("http://localhost/api/admin/candy-count-status", "POST", { guessingOpen: true }));
    };
    expectRejectsNonAdmin({ label: "POST /api/admin/candy-count-status", call, successStatus: 200 });
  });

  describe("POST /api/admin/migrate-phone-encryption", () => {
    const call = async () => {
      const { POST } = await import("@/app/api/admin/migrate-phone-encryption/route");
      return POST();
    };
    expectRejectsNonAdmin({ label: "POST /api/admin/migrate-phone-encryption", call, successStatus: 200 });
  });

  describe("POST /api/guests (manual guest entry)", () => {
    const call = async () => {
      const { POST } = await import("@/app/api/guests/route");
      return POST(
        jsonRequest("http://localhost/api/guests", "POST", {
          firstName: "New",
          lastName: "Guest",
          bracket: "adult-male",
        }),
      );
    };
    expectRejectsNonAdmin({ label: "POST /api/guests", call, successStatus: 201 });
  });

  describe("DELETE /api/guests/[id]", () => {
    const call = async () => {
      const { DELETE } = await import("@/app/api/guests/[id]/route");
      return DELETE(jsonRequest("http://localhost/api/guests/00000000-0000-0000-0000-00000000b1b1", "DELETE"), paramsOf({ id: "00000000-0000-0000-0000-00000000b1b1" }));
    };
    expectRejectsNonAdmin({ label: "DELETE /api/guests/[id]", call, successStatus: 200 });
  });

  describe("GET /api/import (list CSV mappers)", () => {
    const call = async () => {
      const { GET } = await import("@/app/api/import/route");
      return GET();
    };
    expectRejectsNonAdmin({ label: "GET /api/import", call, successStatus: 200 });
  });

  describe("POST /api/import (parse CSV)", () => {
    const call = async () => {
      const { POST } = await import("@/app/api/import/route");
      const formData = new FormData();
      // Two columns deliberately: Papa.parse reports a non-fatal
      // "UndetectableDelimiter" warning for a single-column CSV (nothing to
      // detect a delimiter between), which parseCsvToRows treats as fatal —
      // a pre-existing CSV-importer quirk unrelated to this file's subject,
      // just avoided here rather than fixed.
      formData.append("file", new File(["name,rsvp\nJohn Smith,yes"], "guests.csv", { type: "text/csv" }));
      return POST(new Request("http://localhost/api/import", { method: "POST", body: formData }) as never);
    };
    expectRejectsNonAdmin({ label: "POST /api/import", call, successStatus: 200 });
  });

  describe("POST /api/import/confirm (write imported guests)", () => {
    const call = async () => {
      const { POST } = await import("@/app/api/import/confirm/route");
      return POST(
        jsonRequest("http://localhost/api/import/confirm", "POST", {
          guests: [{ firstName: "John", lastName: "Smith", bracket: "adult-male" }],
        }),
      );
    };
    expectRejectsNonAdmin({ label: "POST /api/import/confirm", call, successStatus: 201 });
  });

  describe("PATCH /api/groups/[id] (rename group)", () => {
    const call = async () => {
      const { PATCH } = await import("@/app/api/groups/[id]/route");
      return PATCH(
        jsonRequest("http://localhost/api/groups/00000000-0000-0000-0000-00000000d1d1", "PATCH", { name: "Renamed" }),
        paramsOf({ id: "00000000-0000-0000-0000-00000000d1d1" }),
      );
    };
    expectRejectsNonAdmin({ label: "PATCH /api/groups/[id]", call, successStatus: 200 });
  });

  describe("DELETE /api/groups/[id]", () => {
    const call = async () => {
      const { DELETE } = await import("@/app/api/groups/[id]/route");
      return DELETE(jsonRequest("http://localhost/api/groups/00000000-0000-0000-0000-00000000d1d1", "DELETE"), paramsOf({ id: "00000000-0000-0000-0000-00000000d1d1" }));
    };
    expectRejectsNonAdmin({ label: "DELETE /api/groups/[id]", call, successStatus: 200 });
  });

  describe("DELETE /api/groups/[id]/members/[guestId]", () => {
    const call = async () => {
      const { DELETE } = await import("@/app/api/groups/[id]/members/[guestId]/route");
      return DELETE(
        jsonRequest("http://localhost/api/groups/00000000-0000-0000-0000-00000000d1d1/members/00000000-0000-0000-0000-00000000b1b1", "DELETE"),
        paramsOf({ id: "00000000-0000-0000-0000-00000000d1d1", guestId: "00000000-0000-0000-0000-00000000b1b1" }),
      );
    };
    expectRejectsNonAdmin({ label: "DELETE /api/groups/[id]/members/[guestId]", call, successStatus: 200 });
  });
});

describe("PATCH /api/guests/[id] — admin-or-self, never a different guest", () => {
  async function call(id: string) {
    const { PATCH } = await import("@/app/api/guests/[id]/route");
    return PATCH(
      jsonRequest(`http://localhost/api/guests/${id}`, "PATCH", { firstName: "Updated" }),
      paramsOf({ id }),
    );
  }

  it("rejects an unauthenticated request", async () => {
    currentSessionGuestId = null;
    expect((await call("00000000-0000-0000-0000-00000000b1b1")).status).toBe(401);
  });

  it("rejects a guest editing a DIFFERENT guest's record", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b2b2";
    expect((await call("00000000-0000-0000-0000-00000000b1b1")).status).toBe(401);
  });

  it("allows a guest editing their own record", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b1b1";
    expect((await call("00000000-0000-0000-0000-00000000b1b1")).status).toBe(200);
  });

  it("allows an admin editing any guest's record", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000a1a1";
    expect((await call("00000000-0000-0000-0000-00000000b1b1")).status).toBe(200);
  });
});

describe("POST /api/photos — public self-service upload, but only admin can bypass the pending-approval gate", () => {
  function photoRequest(guestId: string) {
    const formData = new FormData();
    formData.append("guestId", guestId);
    formData.append("file", new File([TINY_JPEG], "photo.jpg", { type: "image/jpeg" }));
    return new Request("http://localhost/api/photos", { method: "POST", body: formData }) as never;
  }

  async function call(guestId: string) {
    const { POST } = await import("@/app/api/photos/route");
    return POST(photoRequest(guestId));
  }

  it("a non-pending guest can upload their own photo with no admin session at all", async () => {
    currentSessionGuestId = null; // self-service upload is deliberately public
    expect((await call("00000000-0000-0000-0000-00000000b1b1")).status).toBe(200);
  });

  it("a pending guest cannot upload their own photo without admin approval (no session)", async () => {
    currentSessionGuestId = null;
    expect((await call("00000000-0000-0000-0000-00000000c1c1")).status).toBe(403);
  });

  it("a pending guest cannot bypass the gate just by having SOME valid (non-admin) session", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b2b2"; // a different, non-admin, non-pending guest's session
    expect((await call("00000000-0000-0000-0000-00000000c1c1")).status).toBe(403);
  });

  it("an admin session CAN upload on behalf of a still-pending guest", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000a1a1";
    expect((await call("00000000-0000-0000-0000-00000000c1c1")).status).toBe(200);
  });
});

describe("Dual-mode routes never let a non-admin impersonate another guest via admin-only fields", () => {
  it("POST /api/groups: a non-admin's creatorGuestId is ignored in favor of their own session identity", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b2b2";
    const { POST } = await import("@/app/api/groups/route");
    const res = await POST(
      jsonRequest("http://localhost/api/groups", "POST", { name: "G", creatorGuestId: "00000000-0000-0000-0000-00000000b1b1" }),
    );
    expect(res.status).toBe(201);
    expect(fakeStore.addGroup).toHaveBeenCalledWith(
      expect.objectContaining({ creatorGuestId: "00000000-0000-0000-0000-00000000b2b2" }),
    );
  });

  it("POST /api/groups: an admin's explicit creatorGuestId is honored", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000a1a1";
    const { POST } = await import("@/app/api/groups/route");
    const res = await POST(
      jsonRequest("http://localhost/api/groups", "POST", { name: "G", creatorGuestId: "00000000-0000-0000-0000-00000000b1b1" }),
    );
    expect(res.status).toBe(201);
    expect(fakeStore.addGroup).toHaveBeenCalledWith(
      expect.objectContaining({ creatorGuestId: "00000000-0000-0000-0000-00000000b1b1" }),
    );
  });

  it("POST /api/groups: rejects an unauthenticated caller outright", async () => {
    currentSessionGuestId = null;
    const { POST } = await import("@/app/api/groups/route");
    const res = await POST(jsonRequest("http://localhost/api/groups", "POST", { name: "G" }));
    expect(res.status).toBe(401);
  });

  it("POST /api/groups/[id]/members: a non-admin can only add themselves", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b1b1";
    const { POST } = await import("@/app/api/groups/[id]/members/route");
    const res = await POST(
      jsonRequest("http://localhost/api/groups/00000000-0000-0000-0000-00000000d1d1/members", "POST", {}),
      paramsOf({ id: "00000000-0000-0000-0000-00000000d1d1" }),
    );
    expect(res.status).toBe(200);
    expect(fakeStore.addGuestToGroup).toHaveBeenCalledWith("00000000-0000-0000-0000-00000000d1d1", "00000000-0000-0000-0000-00000000b1b1", "00000000-0000-0000-0000-00000000b1b1");
  });

  it("POST /api/groups/[id]/members: an admin can add an arbitrary guestId", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000a1a1";
    const { POST } = await import("@/app/api/groups/[id]/members/route");
    const res = await POST(
      jsonRequest("http://localhost/api/groups/00000000-0000-0000-0000-00000000d1d1/members", "POST", { guestId: "00000000-0000-0000-0000-00000000b2b2" }),
      paramsOf({ id: "00000000-0000-0000-0000-00000000d1d1" }),
    );
    expect(res.status).toBe(200);
    expect(fakeStore.addGuestToGroup).toHaveBeenCalledWith("00000000-0000-0000-0000-00000000d1d1", "00000000-0000-0000-0000-00000000b2b2", "00000000-0000-0000-0000-00000000b2b2");
  });

  it("POST /api/groups/[id]/members: rejects an unauthenticated caller outright", async () => {
    currentSessionGuestId = null;
    const { POST } = await import("@/app/api/groups/[id]/members/route");
    const res = await POST(
      jsonRequest("http://localhost/api/groups/00000000-0000-0000-0000-00000000d1d1/members", "POST", {}),
      paramsOf({ id: "00000000-0000-0000-0000-00000000d1d1" }),
    );
    expect(res.status).toBe(401);
  });
});

describe("No guest data or internal state leaks in rejected/gated responses", () => {
  it("GET /api/guests omits phone/isAdmin/checkedInAt for a non-admin caller", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b1b1";
    const { GET } = await import("@/app/api/guests/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guests: Record<string, unknown>[] };
    for (const g of body.guests) {
      expect(g).not.toHaveProperty("phone");
      expect(g).not.toHaveProperty("isAdmin");
      expect(g).not.toHaveProperty("checkedInAt");
      expect(g).not.toHaveProperty("source");
    }
  });

  it("GET /api/guests includes the full record for an admin caller", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000a1a1";
    const { GET } = await import("@/app/api/guests/route");
    const res = await GET();
    const body = (await res.json()) as { guests: Record<string, unknown>[] };
    expect(body.guests.some((g) => "isAdmin" in g)).toBe(true);
  });

  it("GET /api/votes/results: a non-admin gets 403 with no tallied results before publish", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b1b1";
    const { GET } = await import("@/app/api/votes/results/route");
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).not.toHaveProperty("results");
  });

  it("GET /api/votes/results: an admin can see results before publish", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000a1a1";
    const { GET } = await import("@/app/api/votes/results/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("results");
  });

  it("GET /api/candy-count/results: a non-admin gets 403 with no results before publish", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b1b1";
    const { GET } = await import("@/app/api/candy-count/results/route");
    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).not.toHaveProperty("results");
  });
});
