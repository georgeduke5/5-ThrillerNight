// @vitest-environment jsdom
/**
 * Covers claiming a party-presence token carried in the home page's own
 * URL (?token=...) — see HomeNavButtons.tsx's own doc comment for the three
 * outcomes this distinguishes. This is the regression suite for a real
 * bug: a guest (or an admin recovering access — see README) pasting a
 * token copied by hand from the Settings sheet landed on the "find the
 * check-in QR code" screen with zero indication why, because a claim
 * failure (valid "no" or a genuine server error) was treated identically
 * and silently, and the token was stripped from the URL either way,
 * leaving no way to retry or even notice something needed fixing.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { HomeNavButtons } from "./HomeNavButtons";

const replaceMock = vi.fn();
let searchParamsValue: URLSearchParams;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => replaceMock(...args) }),
  useSearchParams: () => searchParamsValue,
}));

const GUEST = {
  id: "guest-1",
  firstName: "Gus",
  lastName: "Est",
  bracket: "adult-male",
  photoRef: null,
  photoUrl: "https://example.com/gus.jpg",
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  phone: null,
  checkedInAt: null,
  pendingApprovalAt: null,
  isAdmin: false,
};

type Handler = (init?: RequestInit) => { ok: boolean; status?: number; body: unknown };

function installFetchMock(overrides: Record<string, Handler> = {}) {
  const defaults: Record<string, Handler> = {
    "GET /api/guests": () => ({ ok: true, body: { guests: [GUEST] } }),
    "GET /api/auth/session": () => ({ ok: true, body: { guestId: null, isAdmin: false } }),
    "GET /api/votes/status": () => ({
      ok: true,
      body: { selfServiceWalkinEnabled: true, checkInGateOpen: true },
    }),
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
  replaceMock.mockClear();
  searchParamsValue = new URLSearchParams();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a valid token", () => {
  it("claims the gate, opens check-in immediately, and strips the token from the URL", async () => {
    searchParamsValue = new URLSearchParams({ token: "valid-token-123" });
    const fetchMock = installFetchMock({
      "POST /api/auth/checkin-gate/claim": () => ({ ok: true, body: { ok: true } }),
    });
    render(<HomeNavButtons placeholderImage="/p.png" navButtons={[]} />);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url) === "/api/auth/checkin-gate/claim"),
      ).toBe(true),
    );
    // The gate claimed successfully opens VerifyIdentityModal straight to
    // name search (no "find the check-in QR code" screen) — proving the
    // claim's result actually reached CheckInButton's autoOpen, not just
    // that the fetch happened.
    await screen.findByPlaceholderText(/start typing your name/i);
    expect(screen.queryByText(/find the check-in qr code/i)).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/");
    expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn.t verify the code/i)).not.toBeInTheDocument();
  });
});

describe("a superseded/invalid token (a definitive 'no')", () => {
  it("shows the invalid-code message and still strips the token from the URL", async () => {
    searchParamsValue = new URLSearchParams({ token: "stale-token" });
    installFetchMock({
      "POST /api/auth/checkin-gate/claim": () => ({ ok: true, body: { ok: false } }),
    });
    render(<HomeNavButtons placeholderImage="/p.png" navButtons={[]} />);

    await screen.findByText(/that check-in code is no longer valid/i);
    expect(screen.getByText(/scan the current code at the door/i)).toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/");
    // Never silently auto-opens check-in for a rejected token.
    expect(screen.queryByPlaceholderText(/start typing your name/i)).not.toBeInTheDocument();
  });
});

describe("the claim route fails (5xx) — not a proven 'no'", () => {
  it("shows the retry message, keeps the token in the URL, and does not strip it", async () => {
    searchParamsValue = new URLSearchParams({ token: "good-token-but-server-down" });
    installFetchMock({
      "POST /api/auth/checkin-gate/claim": () => ({
        ok: false,
        status: 503,
        body: { ok: false, error: "Couldn't verify the code right now. Please try again." },
      }),
    });
    render(<HomeNavButtons placeholderImage="/p.png" navButtons={[]} />);

    await screen.findByText(/couldn.t verify the code, please try again/i);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/no longer valid/i)).not.toBeInTheDocument();
  });

  it("'Try again' re-attempts the claim against the same token, without it ever having left the URL", async () => {
    searchParamsValue = new URLSearchParams({ token: "good-token-but-server-down" });
    let attempt = 0;
    const fetchMock = installFetchMock({
      "POST /api/auth/checkin-gate/claim": () => {
        attempt += 1;
        return attempt === 1
          ? { ok: false, status: 503, body: { ok: false, error: "temporarily unavailable" } }
          : { ok: true, body: { ok: true } };
      },
    });
    render(<HomeNavButtons placeholderImage="/p.png" navButtons={[]} />);
    await screen.findByText(/couldn.t verify the code, please try again/i);
    expect(replaceMock).not.toHaveBeenCalled();

    screen.getByRole("button", { name: /try again/i }).click();

    await waitFor(() => {
      const claimCalls = fetchMock.mock.calls.filter(([url]) => String(url) === "/api/auth/checkin-gate/claim");
      expect(claimCalls).toHaveLength(2);
    });
    // Both attempts used the exact same token — never re-derived from
    // somewhere else, and never lost between the first failure and the retry.
    const bodies = fetchMock.mock.calls
      .filter(([url]) => String(url) === "/api/auth/checkin-gate/claim")
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)).token);
    expect(bodies).toEqual(["good-token-but-server-down", "good-token-but-server-down"]);

    await screen.findByPlaceholderText(/start typing your name/i);
    expect(replaceMock).toHaveBeenCalledWith("/"); // only stripped once the retry actually succeeded
  });
});

describe("a network-level failure (fetch itself throws)", () => {
  it("is treated the same as a 5xx — retry message, token kept", async () => {
    searchParamsValue = new URLSearchParams({ token: "any-token" });
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url) === "/api/auth/checkin-gate/claim") throw new Error("network down");
      if (String(url).includes("/api/guests")) return { ok: true, json: async () => ({ guests: [GUEST] }) } as Response;
      if (String(url).includes("/api/auth/session"))
        return { ok: true, json: async () => ({ guestId: null, isAdmin: false }) } as Response;
      throw new Error("unhandled: " + url);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HomeNavButtons placeholderImage="/p.png" navButtons={[]} />);
    await screen.findByText(/couldn.t verify the code, please try again/i);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe("no token in the URL", () => {
  it("never calls the claim route at all, and shows no message", async () => {
    searchParamsValue = new URLSearchParams();
    const fetchMock = installFetchMock();
    render(<HomeNavButtons placeholderImage="/p.png" navButtons={[]} />);
    await screen.findByRole("button", { name: /check in/i });
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/auth/checkin-gate/claim")).toBe(false);
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
