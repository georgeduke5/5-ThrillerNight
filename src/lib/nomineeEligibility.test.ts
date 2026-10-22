import { describe, expect, it } from "vitest";
import type { Group, Guest, Vote } from "@/lib/data-access/types";
import type { VotingCategory } from "@/lib/config/types";
import { getEligibleNominees, isEligibleGroupNominee, isEligibleGuestNominee } from "./nomineeEligibility";
import { findInvalidSelection } from "./voteSelections";
import { computeResults } from "./data-access/results";

const AT = "2026-10-21T20:00:00.000Z";

function guest(id: string, overrides: Partial<Guest> = {}): Guest {
  return {
    id,
    firstName: id,
    lastName: "Lee",
    bracket: "boy",
    phone: null,
    photoRef: null,
    photoUrl: null,
    source: "csv-import",
    createdAt: AT,
    groupId: null,
    checkedInAt: AT,
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

function group(id: string, memberIds: string[]): Group {
  return { id, name: id, photoRef: null, photoUrl: null, memberIds, createdAt: AT };
}

const checkedIn = guest("checked-in");
const imported = guest("imported", { checkedInAt: null });
const pending = guest("pending", { checkedInAt: null, pendingApprovalAt: AT });
const rejected = guest("rejected", { checkedInAt: null, pendingApprovalAt: null, source: "walk-in" });
const bothSet = guest("both-set", { pendingApprovalAt: AT });
const girl = guest("girl", { bracket: "girl" });
const GUESTS = [checkedIn, imported, pending, rejected, bothSet, girl];
const GROUPS = [
  group("mixed", ["imported", "checked-in"]),
  group("nobody-in", ["imported", "pending"]),
  group("empty", []),
];

const CATEGORIES: VotingCategory[] = [
  { id: "best-boy-costume", label: "Best Boy's Costume", bracket: "boy" },
  { id: "best-group-costume", label: "Best Group Costume", bracket: null, nomineeType: "group" },
];

describe("nominee eligibility", () => {
  it("a guest is eligible only while fully checked in", () => {
    expect(isEligibleGuestNominee(checkedIn)).toBe(true);
    for (const g of [imported, pending, rejected, bothSet]) expect(isEligibleGuestNominee(g)).toBe(false);
  });

  it("a group is eligible while at least one member is checked in", () => {
    const byId = new Map(GUESTS.map((g) => [g.id, g]));
    expect(isEligibleGroupNominee(GROUPS[0]!, byId)).toBe(true);
    expect(isEligibleGroupNominee(GROUPS[1]!, byId)).toBe(false);
    expect(isEligibleGroupNominee(GROUPS[2]!, byId)).toBe(false);
    expect(isEligibleGroupNominee(group("gone", ["deleted-guest"]), byId)).toBe(false);
  });

  it("getEligibleNominees lists exactly those ids", () => {
    const { guestIds, groupIds } = getEligibleNominees(GUESTS, GROUPS);
    expect([...guestIds]).toEqual(["checked-in", "girl"]);
    expect([...groupIds]).toEqual(["mixed"]);
  });
});

describe("findInvalidSelection", () => {
  it("rejects a guest who isn't checked in, and a group with no checked-in member", () => {
    for (const id of ["imported", "pending", "rejected", "both-set"]) {
      expect(
        findInvalidSelection([{ category: "best-boy-costume", nomineeId: id }], CATEGORIES, GUESTS, GROUPS),
      ).toMatch(/can't be voted for until they've checked in/);
    }
    expect(
      findInvalidSelection([{ category: "best-group-costume", nomineeId: "nobody-in" }], CATEGORIES, GUESTS, GROUPS),
    ).toMatch(/until one of its members has checked in/);
  });

  it("accepts eligible nominees and still applies the bracket", () => {
    expect(
      findInvalidSelection(
        [
          { category: "best-boy-costume", nomineeId: "checked-in" },
          { category: "best-group-costume", nomineeId: "mixed" },
        ],
        CATEGORIES,
        GUESTS,
        GROUPS,
      ),
    ).toBeNull();
    expect(
      findInvalidSelection([{ category: "best-boy-costume", nomineeId: "girl" }], CATEGORIES, GUESTS, GROUPS),
    ).toMatch(/isn't eligible for "Best Boy's Costume"/);
  });
});

describe("computeResults", () => {
  const vote = (category: string, nomineeId: string, voter: string): Vote => ({
    voterGuestId: voter,
    category,
    nomineeId,
    timestamp: AT,
  });
  const VOTES = [
    vote("best-boy-costume", "checked-in", "v1"),
    vote("best-boy-costume", "pending", "v2"),
    vote("best-boy-costume", "pending", "v3"),
    vote("best-group-costume", "mixed", "v1"),
    vote("best-group-costume", "nobody-in", "v2"),
  ];

  it("doesn't count votes for a nominee who isn't currently eligible", () => {
    const [boys, groups] = computeResults(GUESTS, GROUPS, VOTES, CATEGORIES);
    expect(boys!.tallies.map((t) => [t.nomineeId, t.voteCount])).toEqual([["checked-in", 1]]);
    expect(groups!.tallies.map((t) => [t.nomineeId, t.voteCount])).toEqual([["mixed", 1]]);
  });

  it("counts them again once that guest is checked back in", () => {
    const back = GUESTS.map((g) => (g.id === "pending" ? { ...g, checkedInAt: AT, pendingApprovalAt: null } : g));
    const [boys] = computeResults(back, GROUPS, VOTES, CATEGORIES);
    expect(boys!.tallies.map((t) => [t.nomineeId, t.voteCount])).toEqual([
      ["pending", 2],
      ["checked-in", 1],
    ]);
  });
});
