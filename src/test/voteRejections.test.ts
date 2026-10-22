/**
 * POST /api/votes, called directly (skipping the UI): it rejects a vote
 * while voting is closed, and a vote for a nominee who isn't checked in,
 * even from a verified guest. Nothing is recorded either way.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordVote = vi.fn();
let isOpen = false;

const AT = "2026-10-21T20:00:00.000Z";
const guest = (id: string, checkedInAt: string | null, pendingApprovalAt: string | null = null) => ({
  id,
  firstName: id,
  lastName: "Lee",
  bracket: "adult-male",
  checkedInAt,
  pendingApprovalAt,
});
// guest-1 is the voter; guest-2 imported but never checked in; guest-3
// pending; guest-4 checked in.
const GUESTS = [guest("guest-1", AT), guest("guest-2", null), guest("guest-3", null, AT), guest("guest-4", AT)];

vi.mock("@/lib/auth/voterSession", () => ({ getSessionGuestId: vi.fn(async () => "guest-1") }));
vi.mock("@/lib/config", () => ({
  getSiteConfig: () => ({
    features: { votingModuleEnabled: true },
    voting: { categories: [{ id: "best-adult-male-costume", label: "Best Men's Costume", bracket: "adult-male" }] },
  }),
}));
vi.mock("@/lib/data-access", () => ({
  getDataStore: () => ({
    getVotingStatus: async () => ({ isOpen, resultsPublished: false }),
    getGuestById: async (id: string) => GUESTS.find((g) => g.id === id) ?? null,
    getGuests: async () => GUESTS,
    getGroups: async () => [],
    recordVote,
  }),
}));

function voteRequest(nomineeId = "guest-4") {
  return new Request("http://localhost/api/votes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selections: [{ category: "best-adult-male-costume", nomineeId }] }),
  }) as never;
}

beforeEach(() => {
  recordVote.mockReset();
  isOpen = false;
});

describe("POST /api/votes while voting is closed", () => {
  it("returns 403 and records nothing", async () => {
    const { POST } = await import("@/app/api/votes/route");
    const res = await POST(voteRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/voting is currently closed/i);
    expect(recordVote).not.toHaveBeenCalled();
  });
});

describe("POST /api/votes for a nominee who isn't checked in", () => {
  it.each([
    ["imported but not checked in", "guest-2"],
    ["pending", "guest-3"],
  ])("rejects a vote for a guest who is %s", async (_label, nomineeId) => {
    isOpen = true;
    const { POST } = await import("@/app/api/votes/route");
    const res = await POST(voteRequest(nomineeId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/can't be voted for until they've checked in/);
    expect(recordVote).not.toHaveBeenCalled();
  });

  it("still records a vote for a checked-in guest", async () => {
    isOpen = true;
    recordVote.mockImplementation(async (v: object) => ({ ...v, timestamp: AT }));
    const { POST } = await import("@/app/api/votes/route");
    const res = await POST(voteRequest("guest-4"));
    expect(res.status).toBe(200);
    expect(recordVote).toHaveBeenCalledWith({
      voterGuestId: "guest-1",
      category: "best-adult-male-costume",
      nomineeId: "guest-4",
    });
  });
});
