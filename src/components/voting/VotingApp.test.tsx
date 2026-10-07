// @vitest-environment jsdom
/**
 * Integration coverage for the two-level voting flow: the "Voting
 * Categories" hub, drilling into a single category's existing swipeable
 * gallery (CategoryVoteCard — untouched, not re-tested here), "Back to
 * Voting Categories", per-category voted/not-voted status on the hub, and
 * that all five categories are independently reachable with independently
 * recorded votes. Only fetch is mocked; VerifyIdentityModal never mounts in
 * any of these since the mocked session is always already identified (a
 * voterGuestId is returned from GET /api/votes), so no WebAuthn/navigation
 * mocking is needed either.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Group, Guest, VotingStatus } from "@/lib/data-access";
import type { VotingCategory } from "@/lib/config/types";
import { VotingApp } from "./VotingApp";

// jsdom doesn't implement Element.scrollTo (CategoryVoteCard's carousel
// auto-centers on the voter's existing pick via this) — a no-op stand-in is
// all that's needed since this suite never asserts on scroll position.
beforeAll(() => {
  Element.prototype.scrollTo = function () {};
});

const CATEGORIES: VotingCategory[] = [
  { id: "best-adult-male-costume", label: "Best Adult Male Costume", bracket: "adult-male" },
  { id: "best-adult-female-costume", label: "Best Adult Female Costume", bracket: "adult-female" },
  { id: "best-boy-costume", label: "Best Boy Costume", bracket: "boy" },
  { id: "best-girl-costume", label: "Best Girl Costume", bracket: "girl" },
  { id: "best-group-costume", label: "Best Group Costume", bracket: null, nomineeType: "group" },
];

function makeGuest(overrides: Partial<Guest>): Guest {
  return {
    id: "unset",
    firstName: "Test",
    lastName: "Guest",
    bracket: "adult-male",
    phone: null,
    photoRef: null,
    photoUrl: null,
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    groupId: null,
    checkedInAt: "2026-01-01T00:00:00.000Z",
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

const VOTER_ID = "voter-1";
const GUESTS: Guest[] = [
  makeGuest({ id: VOTER_ID, firstName: "Vick", lastName: "Voter", bracket: "adult-male" }),
  makeGuest({ id: "male-1", firstName: "Max", lastName: "Reaper", bracket: "adult-male" }),
  makeGuest({ id: "female-1", firstName: "Mona", lastName: "Morticia", bracket: "adult-female" }),
  makeGuest({ id: "boy-1", firstName: "Pee", lastName: "Wee", bracket: "boy" }),
  makeGuest({ id: "girl-1", firstName: "Wendy", lastName: "Addams", bracket: "girl" }),
];
const GROUPS: Group[] = [
  { id: "group-1", name: "Ghostbusters Crew", photoRef: null, photoUrl: null, memberIds: ["male-1"], createdAt: "2026-01-01T00:00:00.000Z" },
];

const STATUS_OPEN: VotingStatus = {
  isOpen: true,
  resultsPublished: false,
  phoneVerificationEnabled: true,
  passkeyAuthEnabled: true,
  selfServiceWalkinEnabled: true,
  inPersonCheckInEnabled: true,
};

type Handler = (init?: RequestInit) => { ok: boolean; status?: number; body: unknown };

function installFetchMock(overrides: Record<string, Handler> = {}) {
  const defaults: Record<string, Handler> = {
    "GET /api/guests": () => ({ ok: true, body: { guests: GUESTS } }),
    "GET /api/groups": () => ({ ok: true, body: { groups: GROUPS } }),
    "GET /api/votes/status": () => ({ ok: true, body: STATUS_OPEN }),
    "GET /api/votes": () => ({ ok: true, body: { voterGuestId: VOTER_ID, votes: [] } }),
    "POST /api/votes": (init) => {
      const parsed = JSON.parse(String(init?.body)) as { selections: { category: string; nomineeId: string }[] };
      return {
        ok: true,
        body: {
          votes: parsed.selections.map((s) => ({
            voterGuestId: VOTER_ID,
            category: s.category,
            nomineeId: s.nomineeId,
            timestamp: "2026-01-01T00:00:00.000Z",
          })),
        },
      };
    },
  };
  const handlers = { ...defaults, ...overrides };
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const key = `${method} ${path}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`Unhandled fetch in test: ${key}`);
    const { ok, status = ok ? 200 : 400, body } = handler(init);
    return { ok, status, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderHub(overrides: Record<string, Handler> = {}) {
  const fetchMock = installFetchMock(overrides);
  render(<VotingApp categories={CATEGORIES} placeholderImage="/placeholder.svg" />);
  await screen.findByRole("heading", { name: /voting categories/i });
  return fetchMock;
}

function voteButtonFor(categoryLabel: string | RegExp) {
  return screen.getByRole("button", { name: typeof categoryLabel === "string" ? new RegExp(`vote for ${categoryLabel}`, "i") : categoryLabel });
}

/** The "Voted" badge sits as a sibling above the button, not inside it — see VotingCategoriesHub. */
function votedGroupFor(categoryLabel: string | RegExp) {
  return voteButtonFor(categoryLabel).closest("div");
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Voting Categories hub", () => {
  it("renders all five category buttons with correct labels, config-driven", async () => {
    await renderHub();
    CATEGORIES.forEach((category) => {
      screen.getByRole("button", { name: new RegExp(`vote for ${category.label}`, "i") });
    });
    // Nothing from any category's own gallery leaks onto the hub.
    expect(screen.queryByText("Max Reaper")).not.toBeInTheDocument();
    expect(screen.queryByText("Ghostbusters Crew")).not.toBeInTheDocument();
  });

  it("shows no 'Voted' badge for any category before the guest has voted", async () => {
    await renderHub();
    CATEGORIES.forEach((category) => {
      expect(votedGroupFor(category.label)).not.toHaveTextContent(/voted/i);
    });
  });

  it("reflects voted/not-voted status correctly per category, from prior votes already on the server", async () => {
    await renderHub({
      "GET /api/votes": () => ({
        ok: true,
        body: {
          voterGuestId: VOTER_ID,
          votes: [
            { category: "best-boy-costume", nomineeId: "boy-1" },
            { category: "best-group-costume", nomineeId: "group-1" },
          ],
        },
      }),
    });

    expect(votedGroupFor("Best Boy Costume")).toHaveTextContent(/voted/i);
    expect(votedGroupFor("Best Group Costume")).toHaveTextContent(/voted/i);
    expect(votedGroupFor("Best Adult Male Costume")).not.toHaveTextContent(/voted/i);
    expect(votedGroupFor("Best Adult Female Costume")).not.toHaveTextContent(/voted/i);
    expect(votedGroupFor("Best Girl Costume")).not.toHaveTextContent(/voted/i);
  });
});

describe("Drilling into a category screen", () => {
  it("tapping a category button shows only that category's gallery, nothing from the others", async () => {
    await renderHub();
    fireEvent.click(voteButtonFor("Best Boy Costume"));

    await screen.findByRole("heading", { name: /vote for best boy costume/i });
    // Only the Boy nominee appears...
    screen.getByText("Pee Wee");
    // ...never a nominee from a different bracket/category, and no other
    // category's own heading or hub button.
    expect(screen.queryByText("Max Reaper")).not.toBeInTheDocument();
    expect(screen.queryByText("Mona Morticia")).not.toBeInTheDocument();
    expect(screen.queryByText("Wendy Addams")).not.toBeInTheDocument();
    expect(screen.queryByText("Ghostbusters Crew")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /voting categories/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /vote for best girl costume/i })).not.toBeInTheDocument();
  });

  it("the Group category's screen shows only the group nominee, not individual guests", async () => {
    await renderHub();
    fireEvent.click(voteButtonFor("Best Group Costume"));

    await screen.findByRole("heading", { name: /vote for best group costume/i });
    screen.getByText("Ghostbusters Crew");
    expect(screen.queryByText("Max Reaper")).not.toBeInTheDocument();
    expect(screen.queryByText("Pee Wee")).not.toBeInTheDocument();
  });

  it("voting in a category and tapping 'Back to Voting Categories' returns to the hub, with that category now marked Voted", async () => {
    const fetchMock = await renderHub();
    fireEvent.click(voteButtonFor("Best Boy Costume"));
    await screen.findByRole("heading", { name: /vote for best boy costume/i });

    const slide = screen.getByText("Pee Wee").closest("div") as HTMLElement;
    fireEvent.click(within(slide).getByRole("button", { name: /this costume/i }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/api/votes") && init?.method === "POST")).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /back to voting categories/i }));

    await screen.findByRole("heading", { name: /voting categories/i });
    expect(votedGroupFor("Best Boy Costume")).toHaveTextContent(/voted/i);
    expect(votedGroupFor("Best Adult Male Costume")).not.toHaveTextContent(/voted/i);
  });

  it("'Back to Voting Categories' returns to the hub even without voting first", async () => {
    await renderHub();
    fireEvent.click(voteButtonFor("Best Girl Costume"));
    await screen.findByRole("heading", { name: /vote for best girl costume/i });

    fireEvent.click(screen.getByRole("button", { name: /back to voting categories/i }));
    await screen.findByRole("heading", { name: /voting categories/i });
  });
});

describe("Independent reachability and recording across all five categories", () => {
  it("every category is independently reachable, showing only its own eligible nominees", async () => {
    await renderHub();

    const expectations: Array<{ label: string; nominee: string; others: string[] }> = [
      { label: "Best Adult Male Costume", nominee: "Max Reaper", others: ["Mona Morticia", "Pee Wee", "Wendy Addams", "Ghostbusters Crew"] },
      { label: "Best Adult Female Costume", nominee: "Mona Morticia", others: ["Max Reaper", "Pee Wee", "Wendy Addams", "Ghostbusters Crew"] },
      { label: "Best Boy Costume", nominee: "Pee Wee", others: ["Max Reaper", "Mona Morticia", "Wendy Addams", "Ghostbusters Crew"] },
      { label: "Best Girl Costume", nominee: "Wendy Addams", others: ["Max Reaper", "Mona Morticia", "Pee Wee", "Ghostbusters Crew"] },
      { label: "Best Group Costume", nominee: "Ghostbusters Crew", others: ["Max Reaper", "Mona Morticia", "Pee Wee", "Wendy Addams"] },
    ];

    for (const { label, nominee, others } of expectations) {
      fireEvent.click(voteButtonFor(label));
      await screen.findByRole("heading", { name: new RegExp(`vote for ${label}`, "i") });
      screen.getByText(nominee);
      others.forEach((other) => expect(screen.queryByText(other)).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /back to voting categories/i }));
      await screen.findByRole("heading", { name: /voting categories/i });
    }
  });

  it("voting in each category independently records that category's own pick, and the hub ends up showing all five as Voted", async () => {
    const fetchMock = await renderHub();

    const picks: Array<{ label: string; nomineeText: string; categoryId: string; nomineeId: string }> = [
      { label: "Best Adult Male Costume", nomineeText: "Max Reaper", categoryId: "best-adult-male-costume", nomineeId: "male-1" },
      { label: "Best Adult Female Costume", nomineeText: "Mona Morticia", categoryId: "best-adult-female-costume", nomineeId: "female-1" },
      { label: "Best Boy Costume", nomineeText: "Pee Wee", categoryId: "best-boy-costume", nomineeId: "boy-1" },
      { label: "Best Girl Costume", nomineeText: "Wendy Addams", categoryId: "best-girl-costume", nomineeId: "girl-1" },
      { label: "Best Group Costume", nomineeText: "Ghostbusters Crew", categoryId: "best-group-costume", nomineeId: "group-1" },
    ];

    for (const pick of picks) {
      fireEvent.click(voteButtonFor(pick.label));
      await screen.findByRole("heading", { name: new RegExp(`vote for ${pick.label}`, "i") });
      const slide = screen.getByText(pick.nomineeText).closest("div") as HTMLElement;
      fireEvent.click(within(slide).getByRole("button", { name: /this costume/i }));
      await waitFor(() => {
        const postCall = fetchMock.mock.calls.find(
          ([url, init]) => String(url).includes("/api/votes") && init?.method === "POST",
        );
        expect(postCall).toBeDefined();
      });
      fireEvent.click(screen.getByRole("button", { name: /back to voting categories/i }));
      await screen.findByRole("heading", { name: /voting categories/i });
    }

    // Each POST carried exactly the category/nominee pair for its own vote
    // — never bleeding into another category.
    const postBodies = fetchMock.mock.calls
      .filter(([url, init]) => String(url).includes("/api/votes") && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)).selections[0]);
    picks.forEach((pick) => {
      expect(postBodies).toContainEqual({ category: pick.categoryId, nomineeId: pick.nomineeId });
    });

    picks.forEach((pick) => {
      expect(votedGroupFor(pick.label)).toHaveTextContent(/voted/i);
    });
  });
});
