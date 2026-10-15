/**
 * The audit fixes around what a not-yet-approved session can do, plus the
 * walk-in endpoint and group join approvals. Real route handlers, real
 * voterSession.ts / adminAccess.ts / checkInGate.ts; only the data layer
 * and next/headers' cookies() are faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Group, Guest, VotingStatus } from "@/lib/data-access";

let cookieJar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
  })),
}));

const ADMIN = "00000000-0000-0000-0000-0000000000c1";
const PENDING_ADMIN = "00000000-0000-0000-0000-0000000000c2";
const GUEST = "00000000-0000-0000-0000-0000000000c3";
const PENDING = "00000000-0000-0000-0000-0000000000c4";
const CREATOR = "00000000-0000-0000-0000-0000000000c5";
const GROUP = "00000000-0000-0000-0000-0000000000d1";
const GATE_TOKEN = "tonights-token";

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
    checkedInAt: "2026-10-31T19:00:00.000Z",
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

let guests: Record<string, Guest>;
let groups: Record<string, Group>;
let status: VotingStatus;
const updateGuest = vi.fn(async (id: string) => guests[id]!);
const addGuest = vi.fn(async (g: Partial<Guest>) => makeGuest({ ...g, id: "00000000-0000-0000-0000-0000000000f1" }));
const approvePendingGuest = vi.fn(async () => {});

vi.mock("@/lib/data-access", () => ({
  getDataStore: () => ({
    getGuestById: async (id: string) => guests[id] ?? null,
    getGuests: async () => Object.values(guests),
    getGroupById: async (id: string) => groups[id] ?? null,
    getVotingStatus: async () => status,
    getCheckInGateToken: async () => GATE_TOKEN,
    getSessionInvalidationThresholds: async () => ({ sessionsInvalidBefore: null, allSessionsInvalidBefore: null }),
    updateGuest,
    addGuest,
    approvePendingGuest,
    // Mirrors GoogleSheetsDataStore.resolveGroupJoinRequest's authorization rule.
    resolveGroupJoinRequest: async (groupId: string, guestId: string, acting: string | null, approve: boolean) => {
      const { PublicError } = await import("@/lib/errors");
      const { getGroupApproverId } = await import("@/lib/groupApprover");
      const g = groups[groupId]!;
      if (!g.pendingMemberIds?.includes(guestId)) throw new PublicError("No join request from that guest.");
      const isApprover = acting === null || acting === getGroupApproverId(g);
      if (!isApprover && !(!approve && acting === guestId)) {
        throw new PublicError("Only the group's creator can answer join requests.");
      }
      g.pendingMemberIds = g.pendingMemberIds.filter((id) => id !== guestId);
      if (approve) g.memberIds = [...g.memberIds, guestId];
      return g;
    },
  }),
}));

async function signInAs(guestId: string | null) {
  const { createVoterSessionToken } = await import("@/lib/auth/voterSession");
  cookieJar = { tn_checkin_gate: GATE_TOKEN };
  if (guestId) cookieJar.tn_voter_session = createVoterSessionToken(null, guestId);
}

function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as never;
}

beforeEach(() => {
  cookieJar = {};
  status = {
    isOpen: true,
    resultsPublished: false,
    phoneVerificationEnabled: true,
    passkeyAuthEnabled: true,
    selfServiceWalkinEnabled: true,
    inPersonCheckInEnabled: true,
  };
  guests = {
    [ADMIN]: makeGuest({ id: ADMIN, isAdmin: true }),
    [PENDING_ADMIN]: makeGuest({
      id: PENDING_ADMIN,
      isAdmin: true,
      checkedInAt: null,
      pendingApprovalAt: "2026-10-31T19:30:00.000Z",
    }),
    [GUEST]: makeGuest({ id: GUEST }),
    [PENDING]: makeGuest({ id: PENDING, checkedInAt: null, pendingApprovalAt: "2026-10-31T19:30:00.000Z" }),
    [CREATOR]: makeGuest({ id: CREATOR, groupId: GROUP }),
  };
  groups = {
    [GROUP]: {
      id: GROUP,
      name: "Ghostbusters",
      photoRef: null,
      photoUrl: null,
      memberIds: [CREATOR],
      createdAt: "2026-01-01T00:00:00.000Z",
      creatorGuestId: CREATOR,
      pendingMemberIds: [GUEST],
    },
  };
  updateGuest.mockClear();
  addGuest.mockClear();
  approvePendingGuest.mockClear();
});

describe("Admin access requires an approved check-in, not just the admin flag", () => {
  it("a pending session for an admin-flagged guest is not an admin", async () => {
    await signInAs(PENDING_ADMIN);
    const { isAdminRequest } = await import("@/lib/auth/adminAccess");
    expect(await isAdminRequest()).toBe(false);
  });

  it("and so can't approve its own pending request", async () => {
    await signInAs(PENDING_ADMIN);
    const { POST } = await import("@/app/api/admin/check-in/route");
    const res = await POST(jsonRequest("http://localhost/api/admin/check-in", "POST", { guestId: PENDING_ADMIN, action: "approve" }));
    expect(res.status).toBe(401);
    expect(approvePendingGuest).not.toHaveBeenCalled();
  });

  it("a checked-in admin still is", async () => {
    await signInAs(ADMIN);
    const { isAdminRequest } = await import("@/lib/auth/adminAccess");
    expect(await isAdminRequest()).toBe(true);
  });
});

describe("A pending session is read-only", () => {
  it("can't edit its own guest record — above all, not the phone number", async () => {
    await signInAs(PENDING);
    const { PATCH } = await import("@/app/api/guests/[id]/route");
    const res = await PATCH(
      jsonRequest(`http://localhost/api/guests/${PENDING}`, "PATCH", { phone: "+15555550100" }),
      { params: Promise.resolve({ id: PENDING }) },
    );
    expect(res.status).toBe(403);
    expect(updateGuest).not.toHaveBeenCalled();
  });

  it("a checked-in guest can still edit their own record", async () => {
    await signInAs(GUEST);
    const { PATCH } = await import("@/app/api/guests/[id]/route");
    const res = await PATCH(
      jsonRequest(`http://localhost/api/guests/${GUEST}`, "PATCH", { firstName: "New" }),
      { params: Promise.resolve({ id: GUEST }) },
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/guests/walkin is enforced server-side", () => {
  const body = { firstName: "Walk", lastName: "In", bracket: "adult-male" };

  it("is rejected when the walk-in toggle is off, whatever the page shows", async () => {
    status = { ...status, selfServiceWalkinEnabled: false };
    await signInAs(null);
    const { POST } = await import("@/app/api/guests/walkin/route");
    expect((await POST(jsonRequest("http://localhost/api/guests/walkin", "POST", body))).status).toBe(403);
    expect(addGuest).not.toHaveBeenCalled();
  });

  it("requires tonight's QR code", async () => {
    cookieJar = {};
    const { POST } = await import("@/app/api/guests/walkin/route");
    expect((await POST(jsonRequest("http://localhost/api/guests/walkin", "POST", body))).status).toBe(403);
    expect(addGuest).not.toHaveBeenCalled();
  });

  it("is rate limited per IP", async () => {
    await signInAs(null);
    const { POST } = await import("@/app/api/guests/walkin/route");
    const headers = { "x-forwarded-for": "203.0.113.77" };
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await POST(jsonRequest("http://localhost/api/guests/walkin", "POST", body, headers))).status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses.slice(5)).toEqual([429, 429]);
    expect(addGuest).toHaveBeenCalledTimes(5);
  });
});

describe("Group join requests need the creator's approval", () => {
  async function answer(actingAs: string, guestId: string, action: "approve" | "decline") {
    await signInAs(actingAs);
    const { POST } = await import("@/app/api/groups/[id]/requests/[guestId]/route");
    return POST(jsonRequest(`http://localhost/api/groups/${GROUP}/requests/${guestId}`, "POST", { action }), {
      params: Promise.resolve({ id: GROUP, guestId }),
    });
  }

  it("the requester can't approve their own request", async () => {
    expect((await answer(GUEST, GUEST, "approve")).status).toBe(403);
    expect(groups[GROUP]!.memberIds).not.toContain(GUEST);
  });

  it("the requester can withdraw it", async () => {
    expect((await answer(GUEST, GUEST, "decline")).status).toBe(200);
    expect(groups[GROUP]!.pendingMemberIds).not.toContain(GUEST);
  });

  it("the creator can approve it, which makes them a member", async () => {
    expect((await answer(CREATOR, GUEST, "approve")).status).toBe(200);
    expect(groups[GROUP]!.memberIds).toContain(GUEST);
  });

  it("a pending session can't answer requests at all", async () => {
    expect((await answer(PENDING, GUEST, "approve")).status).toBe(403);
  });
});
