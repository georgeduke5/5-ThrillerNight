// @vitest-environment jsdom
/**
 * Covers the redesigned check-in method-selection screen: exactly three
 * options in order with Passkey marked Recommended, every failure path
 * (passkey cancel/unsupported, phone send failure) returning the guest to
 * that same screen, In-Person still landing on the server-enforced locked
 * state, and an already-verified guest skipping the screen entirely.
 *
 * Mocks only the three things this component actually talks to: fetch
 * (every API call), @simplewebauthn/browser (the native WebAuthn ceremony),
 * and next/navigation's useRouter (goToPendingLanding). Nothing about the
 * component's own logic is mocked.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Guest } from "@/lib/data-access";
import { VerifyIdentityModal } from "./VerifyIdentityModal";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));

const GUEST: Guest = {
  id: "00000000-0000-0000-0000-00000000b1b1",
  firstName: "Gus",
  lastName: "Est",
  bracket: "adult-male",
  photoRef: null,
  photoUrl: "https://example.com/gus.jpg", // has a photo — skips the optional photo step after verifying
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  phone: null,
  checkedInAt: null,
  pendingApprovalAt: null,
  isAdmin: false,
};

type Handler = (init?: RequestInit) => { ok: boolean; status?: number; body: unknown };

/** Installs global.fetch with a URL+method-keyed dispatch table; unmatched calls fail the test loudly instead of hanging. */
function installFetchMock(overrides: Record<string, Handler> = {}) {
  const defaults: Record<string, Handler> = {
    "POST /api/auth/phone/activate": () => ({ ok: true, body: { switched: false } }),
    "GET /api/votes/status": () => ({
      ok: true,
      body: { selfServiceWalkinEnabled: true, phoneVerificationEnabled: true, passkeyAuthEnabled: true },
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

async function pickGuest() {
  render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText(/start typing your name/i), { target: { value: "Gus" } });
  fireEvent.click(await screen.findByRole("button", { name: /gus est/i }));
}

function methodButtons() {
  return screen.getAllByRole("button").filter((b) => /^Option \d:/.test(b.textContent ?? ""));
}

beforeEach(() => {
  pushMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Method-selection screen", () => {
  it("renders exactly three options, in order, with Recommended on Passkey", async () => {
    installFetchMock();
    await pickGuest();

    await screen.findByRole("heading", { name: /how do you want to check in/i });

    const buttons = methodButtons();
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent("Option 1: Passkey");
    expect(buttons[1]).toHaveTextContent("Option 2: Phone Number");
    expect(buttons[2]).toHaveTextContent("Option 3: In-Person");

    // The badge is real visible text inside the Passkey button, not a
    // decorative/aria-hidden element — so it's part of the button's own
    // accessible name and reachable by any screen reader.
    expect(buttons[0]).toHaveTextContent("Recommended");
    expect(buttons[0]).toHaveAccessibleName(/Option 1: Passkey.*Recommended/s);
  });
});

describe("Passkey failure paths return to method selection", () => {
  it("a failed sign-in (authentication) bounces back with the specific sign-in message, never offering registration", async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    vi.mocked(startAuthentication).mockRejectedValueOnce(new Error("NotAllowedError"));

    const fetchMock = installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "authentication", options: { challenge: "c", rpId: "x", allowCredentials: [] } },
      }),
    });
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /option 1: passkey/i }));

    // Returns to the exact same three-option screen, not a dead end —
    // with the specific "didn't work" message, not a generic one, and no
    // mention of (or path into) registering a fresh passkey.
    await screen.findByRole("heading", { name: /how do you want to check in/i });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/passkey didn.t work\. use phone verification, or find george or sarah\./i);
    expect(alert).not.toHaveTextContent(/regist/i);
    expect(methodButtons()).toHaveLength(3);

    // Tapping Passkey again asks the server fresh — it is NOT silently
    // upgraded to a registration attempt client-side.
    const beginCallsBefore = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/auth/passkey/begin"),
    ).length;
    fireEvent.click(screen.getByRole("button", { name: /option 1: passkey/i }));
    await waitFor(() => {
      const beginCallsAfter = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/api/auth/passkey/begin"),
      ).length;
      expect(beginCallsAfter).toBe(beginCallsBefore + 1);
    });
    const [, secondBeginInit] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]!;
    const secondBeginBody = JSON.parse(String(secondBeginInit?.body));
    expect(secondBeginBody).not.toHaveProperty("retryAsRegistration");
  });

  it("a registration ceremony's own failure keeps the server's own message (not the sign-in-specific one)", async () => {
    const { startRegistration } = await import("@simplewebauthn/browser");
    vi.mocked(startRegistration).mockRejectedValueOnce(new Error("cancelled"));

    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "registration", options: { challenge: "c", rp: { id: "x", name: "x" }, user: {} } },
      }),
    });
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /option 1: passkey/i }));

    await screen.findByRole("heading", { name: /how do you want to check in/i });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/passkey check failed/i);
    expect(alert).not.toHaveTextContent(/find george or sarah/i);
  });

  it("an unsupported browser bounces back with a message, without calling the server", async () => {
    const { browserSupportsWebAuthn } = await import("@simplewebauthn/browser");
    vi.mocked(browserSupportsWebAuthn).mockReturnValueOnce(false);

    const fetchMock = installFetchMock();
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /option 1: passkey/i }));

    await screen.findByRole("heading", { name: /how do you want to check in/i });
    expect(screen.getByRole("alert")).toHaveTextContent(/doesn.t support passkeys/i);
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/passkey/begin"),
      expect.anything(),
    );
  });
});

describe("Phone Number failure path returns to method selection", () => {
  it("a failed send bounces back with a message", async () => {
    installFetchMock({
      "POST /api/auth/phone/start": () => ({ ok: false, body: { error: "Failed to send verification code." } }),
    });
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /option 2: phone number/i }));

    const phoneInput = await screen.findByLabelText(/phone number/i);
    fireEvent.change(phoneInput, { target: { value: "5555550123" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    await screen.findByRole("heading", { name: /how do you want to check in/i });
    expect(screen.getByRole("alert")).toHaveTextContent(/failed to send verification code/i);
    expect(methodButtons()).toHaveLength(3);
  });

  it("a wrong code stays on the code-entry screen for an inline retry, not a bounce-back", async () => {
    installFetchMock({
      "POST /api/auth/phone/start": () => ({ ok: true, body: {} }),
      "POST /api/auth/phone/verify": () => ({ ok: false, body: { error: "Incorrect code." } }),
    });
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /option 2: phone number/i }));
    fireEvent.change(await screen.findByLabelText(/phone number/i), { target: { value: "5555550123" } });
    fireEvent.click(screen.getByRole("button", { name: /send code/i }));

    const codeInput = await screen.findByLabelText(/enter the code sent to/i);
    fireEvent.change(codeInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => expect(screen.getByText(/incorrect code/i)).toBeInTheDocument());
    // Still on the code screen — not bounced back to the three options.
    expect(screen.queryByRole("heading", { name: /how do you want to check in/i })).not.toBeInTheDocument();
    expect(codeInput).toBeInTheDocument();
  });
});

describe("In-Person", () => {
  it("results in the server-enforced locked waiting state", async () => {
    installFetchMock({
      "POST /api/auth/passkey/fallback/give-up": () => ({ ok: true, body: { pendingApproval: true } }),
    });
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /option 3: in-person/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/check-in/pending"));
  });

  it("a failure stays on the method screen with a message", async () => {
    installFetchMock({
      "POST /api/auth/passkey/fallback/give-up": () => ({ ok: false, body: { error: "Couldn't check you in." } }),
    });
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /option 3: in-person/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t check you in/i));
    expect(methodButtons()).toHaveLength(3);
  });
});

describe("Session recovery", () => {
  it("an already-verified guest skips the method-selection screen entirely", async () => {
    installFetchMock({
      "POST /api/auth/phone/activate": () => ({ ok: true, body: { switched: true, pendingApproval: false } }),
    });
    const onVerified = vi.fn();
    render(<VerifyIdentityModal guests={[GUEST]} onVerified={onVerified} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/start typing your name/i), { target: { value: "Gus" } });
    fireEvent.click(await screen.findByRole("button", { name: /gus est/i }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(GUEST.id));
    expect(screen.queryByRole("heading", { name: /how do you want to check in/i })).not.toBeInTheDocument();
  });

  it("an already-verified but still-pending guest is sent straight to the locked waiting screen", async () => {
    installFetchMock({
      "POST /api/auth/phone/activate": () => ({ ok: true, body: { switched: true, pendingApproval: true } }),
    });
    await pickGuest();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/check-in/pending"));
    expect(screen.queryByRole("heading", { name: /how do you want to check in/i })).not.toBeInTheDocument();
  });
});
