// @vitest-environment jsdom
/**
 * Covers the identity-bar parity this component just gained: a signed-in
 * guest sees "Guessing as {name}" (VoterIdentityBar, the same component
 * VotingApp's "Voting as" bar uses), and "Update my info" / "Not you?"
 * correctly wire up to GuestUpdateInfoModal / VerifyIdentityModal — not a
 * re-test of either modal's own internals (covered by their own suites),
 * just that CandyCountApp opens the right one. The pre-existing
 * guess-submission flow is exercised incidentally by these same tests but
 * isn't the focus here.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Guest } from "@/lib/data-access";
import { CandyCountApp } from "./CandyCountApp";

// VerifyIdentityModal (opened by "Not you?") calls useRouter for its
// pending-approval redirect — never actually exercised here, but the
// import still needs a router present to mount at all.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

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
const GUESTS: Guest[] = [makeGuest({ id: VOTER_ID, firstName: "Gus", lastName: "Est" })];

type Handler = (init?: RequestInit) => { ok: boolean; status?: number; body: unknown };

function installFetchMock(overrides: Record<string, Handler> = {}) {
  const defaults: Record<string, Handler> = {
    "GET /api/guests": () => ({ ok: true, body: { guests: GUESTS } }),
    "GET /api/candy-count/status": () => ({ ok: true, body: { guessingOpen: true, resultsPublished: false, trueCount: null } }),
    "GET /api/candy-count": () => ({ ok: true, body: { guestId: VOTER_ID, guess: null } }),
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

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CandyCountApp identity bar", () => {
  it("shows 'Guessing as {name}' for a signed-in guest, via the same VoterIdentityBar component", async () => {
    installFetchMock();
    render(<CandyCountApp placeholderImage="/placeholder.svg" />);
    await screen.findByText(/guessing as/i);
    await screen.findByRole("button", { name: "Gus Est" });
  });

  it("shows no identity bar when no session is active", async () => {
    installFetchMock({ "GET /api/candy-count": () => ({ ok: true, body: { guestId: null, guess: null } }) });
    render(<CandyCountApp placeholderImage="/placeholder.svg" />);
    await screen.findByLabelText(/how many pieces of candy/i);
    expect(screen.queryByText(/guessing as/i)).not.toBeInTheDocument();
  });

  it("'Update my info' opens GuestUpdateInfoModal for the current guest", async () => {
    installFetchMock();
    render(<CandyCountApp placeholderImage="/placeholder.svg" />);
    fireEvent.click(await screen.findByRole("button", { name: /update my info/i }));
    expect(await screen.findByDisplayValue("Gus")).toBeInTheDocument();
  });

  it("'Not you?' opens VerifyIdentityModal to switch identity", async () => {
    installFetchMock();
    render(<CandyCountApp placeholderImage="/placeholder.svg" />);
    fireEvent.click(await screen.findByRole("button", { name: /not you\?/i }));
    await screen.findByRole("heading", { name: /who are you/i });
  });
});
