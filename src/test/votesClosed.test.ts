/**
 * POST /api/votes rejects a vote while voting is closed, even from a
 * verified guest who skips the disabled buttons and calls the API directly.
 * Nothing is recorded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recordVote = vi.fn();
let isOpen = false;

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
    recordVote,
    recordVotes: recordVote,
  }),
}));

function voteRequest() {
  return new Request("http://localhost/api/votes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selections: [{ category: "best-adult-male-costume", nomineeId: "guest-2" }] }),
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
