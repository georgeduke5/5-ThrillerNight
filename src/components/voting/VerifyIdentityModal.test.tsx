// @vitest-environment jsdom
/**
 * Covers the redesigned check-in flow: the party-presence gate (locked
 * screen when closed, straight into verification when open), the single
 * automated path (no more method-selection screen — passkey starts
 * immediately after picking a name), every failure landing on one screen
 * with a "Check in with an admin" option, and an already-verified guest
 * skipping all of it.
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
import { VerifyIdentityModal, resetGateConfirmationForTests } from "./VerifyIdentityModal";

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
      body: {
        selfServiceWalkinEnabled: true,
        phoneVerificationEnabled: true,
        passkeyAuthEnabled: true,
        inPersonCheckInEnabled: true,
        checkInGateOpen: true,
      },
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

/** Waits past the gate check and opens the name-search step, then picks GUEST by name. */
async function pickGuest() {
  render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);
  fireEvent.change(await screen.findByPlaceholderText(/start typing your name/i), { target: { value: "Gus" } });
  fireEvent.click(await screen.findByRole("button", { name: /gus est/i }));
}

beforeEach(() => {
  pushMock.mockClear();
  // The "gate confirmed open" memory is deliberately module-level (see its
  // doc comment in VerifyIdentityModal.tsx) so it survives this modal's own
  // unmount/remount cycle within one real page load — but that means it
  // would otherwise leak between separate tests in this file too.
  resetGateConfirmationForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Party-presence gate", () => {
  it("shows the locked screen instead of name search when the gate isn't open", async () => {
    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: { selfServiceWalkinEnabled: true, checkInGateOpen: false },
      }),
    });
    render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByRole("heading", { name: /find the check-in qr code/i });
    expect(screen.getByText(/scan the code to check in/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/start typing your name/i)).not.toBeInTheDocument();
  });

  it("the locked screen shows a QR-code icon alongside its heading and copy", async () => {
    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: { selfServiceWalkinEnabled: true, checkInGateOpen: false },
      }),
    });
    const { container } = render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByRole("heading", { name: /find the check-in qr code/i });
    const icon = container.querySelector('svg[aria-hidden="true"]');
    expect(icon).not.toBeNull();
  });

  it("shows name search once the gate is confirmed open", async () => {
    installFetchMock();
    render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByPlaceholderText(/start typing your name/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /find the check-in qr code/i })).not.toBeInTheDocument();
  });

  it("falls back to the locked screen if the status read fails outright", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);

    await screen.findByRole("heading", { name: /find the check-in qr code/i });
  });

  it("the walk-in flow (initialGuest set) never shows the locked screen, even with the gate closed", async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(() => {}));

    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: { selfServiceWalkinEnabled: true, checkInGateOpen: false, passkeyAuthEnabled: true, phoneVerificationEnabled: true, inPersonCheckInEnabled: true },
      }),
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "authentication", options: { challenge: "c", rpId: "x", allowCredentials: [] } },
      }),
    });
    render(<VerifyIdentityModal guests={[GUEST]} initialGuest={GUEST} onVerified={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.queryByRole("heading", { name: /find the check-in qr code/i })).not.toBeInTheDocument();
    // Goes straight into the passkey ceremony, same as any other
    // already-known-identity entry point.
    await screen.findByRole("heading", { name: /confirm it.s you/i });
  });

  it("once confirmed open, canceling (unmount) and reopening (remount) never re-locks, even if the re-check's own request then fails", async () => {
    // First mount: a normal, successful gate check — same as "shows name
    // search once the gate is confirmed open" above.
    installFetchMock();
    const { unmount } = render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByPlaceholderText(/start typing your name/i);

    // Canceling out of the modal unmounts it completely — this is exactly
    // what CheckInButton/VotingApp/CandyCountApp do in onCancel (see their
    // own files): the modal has no component state of its own left to
    // remember anything by the time it remounts.
    unmount();

    // Reopening remounts it fresh. If this SECOND status read happens to
    // fail outright (the realistic trigger: a phone's network stack is
    // often momentarily busy right after a native biometric prompt), the
    // guest must NOT be bounced back to "find the check-in qr code" — their gate
    // cookie was never touched, and this page already proved it's good.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByPlaceholderText(/start typing your name/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /find the check-in qr code/i })).not.toBeInTheDocument();
  });

  it("once confirmed open, a later re-check that comes back checkInGateOpen: false still doesn't re-lock the screen", async () => {
    installFetchMock();
    const { unmount } = render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByPlaceholderText(/start typing your name/i);
    unmount();

    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: { selfServiceWalkinEnabled: true, checkInGateOpen: false },
      }),
    });
    render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByPlaceholderText(/start typing your name/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /find the check-in qr code/i })).not.toBeInTheDocument();
  });

  it("a guest who has NEVER confirmed the gate open still correctly sees the locked screen on every reopen", async () => {
    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: { selfServiceWalkinEnabled: true, checkInGateOpen: false },
      }),
    });
    const { unmount } = render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole("heading", { name: /find the check-in qr code/i });
    unmount();

    render(<VerifyIdentityModal guests={[GUEST]} onVerified={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole("heading", { name: /find the check-in qr code/i });
  });
});

describe("Picking a name goes straight into the passkey ceremony, with no method-selection screen", () => {
  it("calls POST /api/auth/passkey/begin immediately after picking a guest", async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    // Hangs forever — these two tests only need to confirm the ceremony
    // actually started, not see it through to completion.
    vi.mocked(startAuthentication).mockImplementationOnce(() => new Promise(() => {}));

    const fetchMock = installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "authentication", options: { challenge: "c", rpId: "x", allowCredentials: [] } },
      }),
    });
    await pickGuest();

    await screen.findByRole("heading", { name: /confirm it.s you/i });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/passkey/begin"))).toBe(true);
    expect(screen.queryByRole("heading", { name: /how do you want to check in/i })).not.toBeInTheDocument();
  });

  it("a first-time registration for a guest with no phone on file goes straight to the ceremony too", async () => {
    const { startRegistration } = await import("@simplewebauthn/browser");
    vi.mocked(startRegistration).mockImplementationOnce(() => new Promise(() => {}));

    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "registration", options: { challenge: "c", rp: { id: "x", name: "x" }, user: {} } },
      }),
    });
    await pickGuest();

    await screen.findByRole("heading", { name: /confirm it.s you/i });
  });

  it("a first-time registration for a guest with a phone on file goes through the on-file-phone code step first", async () => {
    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({ ok: true, body: { mode: "phone-required" } }),
      "POST /api/auth/passkey/phone-gate/start": () => ({ ok: true, body: { ok: true } }),
    });
    await pickGuest();

    await screen.findByText(/enter the code we texted you/i);
    expect(screen.queryByRole("heading", { name: /how do you want to check in/i })).not.toBeInTheDocument();
  });
});

describe("Zero methods enabled", () => {
  it("skips straight to auto-check-in after picking a name", async () => {
    const onVerified = vi.fn();
    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: {
          selfServiceWalkinEnabled: true,
          passkeyAuthEnabled: false,
          phoneVerificationEnabled: false,
          inPersonCheckInEnabled: false,
          checkInGateOpen: true,
        },
      }),
      "POST /api/auth/auto-check-in": () => ({ ok: true, body: { ok: true, pendingApproval: false } }),
    });
    render(<VerifyIdentityModal guests={[GUEST]} onVerified={onVerified} onCancel={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText(/start typing your name/i), { target: { value: "Gus" } });
    fireEvent.click(await screen.findByRole("button", { name: /gus est/i }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(GUEST.id));
  });

  it("sends a pending guest from the auto-check-in path to the locked waiting screen", async () => {
    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: {
          selfServiceWalkinEnabled: true,
          passkeyAuthEnabled: false,
          phoneVerificationEnabled: false,
          inPersonCheckInEnabled: false,
          checkInGateOpen: true,
        },
      }),
      "POST /api/auth/auto-check-in": () => ({ ok: true, body: { ok: true, pendingApproval: true } }),
    });
    await pickGuest();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/check-in/pending"));
  });

  it("a failed auto-check-in (e.g. a toggle flipped between the client's read and this call) lands on the failure screen", async () => {
    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: {
          selfServiceWalkinEnabled: true,
          passkeyAuthEnabled: false,
          phoneVerificationEnabled: false,
          inPersonCheckInEnabled: false,
          checkInGateOpen: true,
        },
      }),
      "POST /api/auth/auto-check-in": () => ({ ok: false, body: { error: "A check-in method is required." } }),
    });
    await pickGuest();

    await screen.findByRole("heading", { name: /couldn.t check you in/i });
    expect(screen.getByRole("alert")).toHaveTextContent(/a check-in method is required/i);
  });
});

describe("Passkey turned off entirely", () => {
  it("goes straight to the failure screen, never attempting a ceremony", async () => {
    const fetchMock = installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: {
          selfServiceWalkinEnabled: true,
          passkeyAuthEnabled: false,
          phoneVerificationEnabled: false,
          inPersonCheckInEnabled: true,
          checkInGateOpen: true,
        },
      }),
    });
    await pickGuest();

    await screen.findByRole("heading", { name: /couldn.t check you in/i });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/passkey/begin"))).toBe(false);
    expect(screen.getByRole("button", { name: /check in with an admin/i })).toBeInTheDocument();
    // Passkey is off, so there's no "Try again" offered.
    expect(screen.queryByRole("button", { name: /^try again$/i })).not.toBeInTheDocument();
  });
});

describe("Passkey failure lands on the failure screen", () => {
  it("a failed sign-in (authentication) shows a specific message and offers Check in with an admin", async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    vi.mocked(startAuthentication).mockRejectedValueOnce(new Error("NotAllowedError"));

    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "authentication", options: { challenge: "c", rpId: "x", allowCredentials: [] } },
      }),
    });
    await pickGuest();

    await screen.findByRole("heading", { name: /couldn.t check you in/i });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/^passkey didn.t work\.$/i);
    expect(screen.getByRole("button", { name: /check in with an admin/i })).toBeInTheDocument();
  });

  it("a registration ceremony's own failure keeps the server's own message", async () => {
    const { startRegistration } = await import("@simplewebauthn/browser");
    vi.mocked(startRegistration).mockRejectedValueOnce(new Error("cancelled"));

    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "registration", options: { challenge: "c", rp: { id: "x", name: "x" }, user: {} } },
      }),
    });
    await pickGuest();

    await screen.findByRole("heading", { name: /couldn.t check you in/i });
    expect(screen.getByRole("alert")).toHaveTextContent(/passkey check failed/i);
  });

  it("an unsupported browser lands on the failure screen without calling the server", async () => {
    const { browserSupportsWebAuthn } = await import("@simplewebauthn/browser");
    vi.mocked(browserSupportsWebAuthn).mockReturnValueOnce(false);

    const fetchMock = installFetchMock();
    await pickGuest();

    await screen.findByRole("heading", { name: /couldn.t check you in/i });
    expect(screen.getByRole("alert")).toHaveTextContent(/doesn.t support passkeys/i);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/passkey/begin"))).toBe(false);
  });

  it("the failure screen omits Check in with an admin when In-Person is disabled", async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    vi.mocked(startAuthentication).mockRejectedValueOnce(new Error("NotAllowedError"));

    installFetchMock({
      "GET /api/votes/status": () => ({
        ok: true,
        body: { selfServiceWalkinEnabled: true, passkeyAuthEnabled: true, phoneVerificationEnabled: true, inPersonCheckInEnabled: false, checkInGateOpen: true },
      }),
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "authentication", options: { challenge: "c", rpId: "x", allowCredentials: [] } },
      }),
    });
    await pickGuest();

    await screen.findByRole("heading", { name: /couldn.t check you in/i });
    expect(screen.queryByRole("button", { name: /check in with an admin/i })).not.toBeInTheDocument();
    expect(screen.getByText(/find george or sarah/i)).toBeInTheDocument();
  });

  it("Try again re-runs the ceremony", async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    vi.mocked(startAuthentication).mockRejectedValueOnce(new Error("NotAllowedError"));

    const fetchMock = installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "authentication", options: { challenge: "c", rpId: "x", allowCredentials: [] } },
      }),
    });
    await pickGuest();
    await screen.findByRole("heading", { name: /couldn.t check you in/i });

    const beginCallsBefore = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/auth/passkey/begin")).length;
    fireEvent.click(screen.getByRole("button", { name: /^try again$/i }));
    await waitFor(() => {
      const beginCallsAfter = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/auth/passkey/begin")).length;
      expect(beginCallsAfter).toBe(beginCallsBefore + 1);
    });
  });
});

describe("Phone-gate code step", () => {
  it("a failed send lands on the failure screen", async () => {
    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({ ok: true, body: { mode: "phone-required" } }),
      "POST /api/auth/passkey/phone-gate/start": () => ({ ok: false, body: { error: "Failed to send verification code." } }),
    });
    await pickGuest();

    await screen.findByRole("heading", { name: /couldn.t check you in/i });
    expect(screen.getByRole("alert")).toHaveTextContent(/failed to send verification code/i);
  });

  it("a wrong code stays on the code-entry screen for an inline retry, not a bounce to the failure screen", async () => {
    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({ ok: true, body: { mode: "phone-required" } }),
      "POST /api/auth/passkey/phone-gate/start": () => ({ ok: true, body: { ok: true } }),
      "POST /api/auth/passkey/phone-gate/verify": () => ({ ok: false, body: { error: "Incorrect code." } }),
    });
    await pickGuest();

    const codeInput = await screen.findByLabelText(/enter the code we texted you/i);
    fireEvent.change(codeInput, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: /^verify$/i }));

    await waitFor(() => expect(screen.getByText(/incorrect code/i)).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: /couldn.t check you in/i })).not.toBeInTheDocument();
    expect(codeInput).toBeInTheDocument();
  });
});

describe("In-person check-in from the failure screen", () => {
  it("results in the server-enforced locked waiting state", async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    vi.mocked(startAuthentication).mockRejectedValueOnce(new Error("NotAllowedError"));

    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "authentication", options: { challenge: "c", rpId: "x", allowCredentials: [] } },
      }),
      "POST /api/auth/passkey/fallback/give-up": () => ({ ok: true, body: { pendingApproval: true } }),
    });
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /check in with an admin/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/check-in/pending"));
  });

  it("a failure here stays on the failure screen with a message", async () => {
    const { startAuthentication } = await import("@simplewebauthn/browser");
    vi.mocked(startAuthentication).mockRejectedValueOnce(new Error("NotAllowedError"));

    installFetchMock({
      "POST /api/auth/passkey/begin": () => ({
        ok: true,
        body: { mode: "authentication", options: { challenge: "c", rpId: "x", allowCredentials: [] } },
      }),
      "POST /api/auth/passkey/fallback/give-up": () => ({ ok: false, body: { error: "Couldn't check you in." } }),
    });
    await pickGuest();
    fireEvent.click(await screen.findByRole("button", { name: /check in with an admin/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t check you in/i));
  });
});

describe("Session recovery", () => {
  it("an already-verified guest skips the gate check and the ceremony entirely", async () => {
    installFetchMock({
      "POST /api/auth/phone/activate": () => ({ ok: true, body: { switched: true, pendingApproval: false } }),
    });
    const onVerified = vi.fn();
    render(<VerifyIdentityModal guests={[GUEST]} onVerified={onVerified} onCancel={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText(/start typing your name/i), { target: { value: "Gus" } });
    fireEvent.click(await screen.findByRole("button", { name: /gus est/i }));

    await waitFor(() => expect(onVerified).toHaveBeenCalledWith(GUEST.id));
    expect(screen.queryByRole("heading", { name: /confirm it.s you/i })).not.toBeInTheDocument();
  });

  it("an already-verified but still-pending guest is sent straight to the locked waiting screen", async () => {
    installFetchMock({
      "POST /api/auth/phone/activate": () => ({ ok: true, body: { switched: true, pendingApproval: true } }),
    });
    await pickGuest();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/check-in/pending"));
  });
});
