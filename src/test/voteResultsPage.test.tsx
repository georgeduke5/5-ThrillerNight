// @vitest-environment jsdom
/**
 * /vote/results — covers the turnout percentage restored in
 * UnpublishedResultsPage's `percent`/`percentCaption` props (see commit
 * 82cc379, which had removed them, and the follow-up that brought them
 * back): shown while results aren't published yet, computed from
 * guests.length vs. the distinct set of voterGuestIds in votes; absent
 * once results ARE published, where this page shows the per-category
 * winners instead and has never shown a turnout line there.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DataStore, Guest, Group, Vote, VotingStatus } from "@/lib/data-access";

afterEach(() => {
  cleanup();
});

function makeGuest(id: string): Guest {
  return {
    id,
    firstName: "Guest",
    lastName: id,
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
  };
}

function makeVote(voterGuestId: string): Vote {
  return { voterGuestId, category: "best-adult-male-costume", nomineeId: "nominee-1", timestamp: "2026-01-01T00:00:00.000Z" };
}

const GUESTS: Guest[] = [makeGuest("g1"), makeGuest("g2"), makeGuest("g3"), makeGuest("g4")];
// 1 of 4 eligible guests has voted -> 25.0%.
const VOTES: Vote[] = [makeVote("g1")];

let votingStatus: VotingStatus;

function makeFakeStore(): DataStore {
  return {
    getGuests: vi.fn(async () => GUESTS),
    getGuestById: vi.fn(async () => null),
    findGuestByName: vi.fn(async () => null),
    addGuest: vi.fn(async () => makeGuest("new")),
    addGuests: vi.fn(async () => []),
    updateGuest: vi.fn(async (id, updates) => ({ ...makeGuest(id), ...updates })),
    savePhotoReference: vi.fn(async () => {}),
    deleteGuest: vi.fn(async () => {}),
    markGuestCheckedIn: vi.fn(async () => {}),
    markGuestPendingApproval: vi.fn(async () => {}),
    approvePendingGuest: vi.fn(async () => {}),
    rejectPendingGuest: vi.fn(async () => {}),
    resetGuestsToPending: vi.fn(async () => {}),
    removePasskeyAndResetToPending: vi.fn(async () => true),
    requestToJoinGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    resolveGroupJoinRequest: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
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

    recordVote: vi.fn(async (v) => ({ ...v, timestamp: "2026-01-01T00:00:00.000Z" })),
    getVotes: vi.fn(async () => VOTES),

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

    getCheckInGateToken: vi.fn(async () => null),
    setCheckInGateToken: vi.fn(async () => {}),

    clearVotesAndCandyGuesses: vi.fn(async () => ({ votesCleared: 0, guessesCleared: 0 })),
    deleteNonAdminPasskeys: vi.fn(async () => ({ deleted: 0, guestIds: [] })),
    getSessionsInvalidBefore: vi.fn(async () => null),
    setSessionsInvalidBefore: vi.fn(async () => {}),
    setAllSessionsInvalidBefore: vi.fn(async () => {}),
    getSessionInvalidationThresholds: vi.fn(async () => ({ sessionsInvalidBefore: null, allSessionsInvalidBefore: null })),
    resetToAdminsOnly: vi.fn(async () => ({
      complete: true,
      steps: [],
      wiped: { guests: 0, votes: 0, candyGuesses: 0, passkeys: 0, groupsDeleted: 0, groupsCleaned: 0, photosDeleted: 0 },
      remaining: { guests: 0, votes: 0, candyGuesses: 0, passkeys: 0, groupsDeleted: 0, groupsCleaned: 0 },
      photosNotDeleted: [],
      adminsKept: [],
      signedOut: true,
      allGuestIds: [],
    })),
  };
}

let fakeStore: DataStore;
vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

vi.mock("@/lib/config", () => ({
  getSiteConfig: () => ({
    features: { votingModuleEnabled: true },
    voting: { categories: [] },
    theme: { backgroundImage: "/bg.jpg", logoImage: "/logo.png" },
    event: { name: "Thriller Night" },
  }),
}));

describe("unpublished results", () => {
  it("shows the turnout percentage and its caption as the hero element", async () => {
    fakeStore = makeFakeStore();
    votingStatus = {
      isOpen: true,
      resultsPublished: false,
      phoneVerificationEnabled: false,
      passkeyAuthEnabled: true,
      selfServiceWalkinEnabled: true,
      inPersonCheckInEnabled: true,
    };
    const { default: VoteResultsPage } = await import("@/app/vote/results/page");

    render(await VoteResultsPage());

    expect(screen.getByText("25.0%")).toBeInTheDocument();
    expect(screen.getByText("of votes are in")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /results aren.t published yet/i })).toBeInTheDocument();
  });
});

describe("published results", () => {
  it("does not show a turnout percentage or its caption", async () => {
    fakeStore = makeFakeStore();
    votingStatus = {
      isOpen: true,
      resultsPublished: true,
      phoneVerificationEnabled: false,
      passkeyAuthEnabled: true,
      selfServiceWalkinEnabled: true,
      inPersonCheckInEnabled: true,
    };
    const { default: VoteResultsPage } = await import("@/app/vote/results/page");

    render(await VoteResultsPage());

    expect(screen.getByRole("heading", { name: /^winners$/i })).toBeInTheDocument();
    expect(screen.queryByText("25.0%")).not.toBeInTheDocument();
    expect(screen.queryByText("of votes are in")).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
