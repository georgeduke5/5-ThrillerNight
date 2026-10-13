// @vitest-environment jsdom
/**
 * The party-presence QR/link rendering rules: the token (and the full URL
 * carrying it) must never appear anywhere in the DOM — not as visible
 * text, not in an alt/title attribute — until the admin deliberately opens
 * "Show link", which starts collapsed on every render. Also covers the
 * "No code generated yet" state and that "Generate New Code" swaps in a
 * freshly generated token's QR.
 *
 * `qrcode` is mocked (jsdom has no real <canvas> 2D context without the
 * optional native `canvas` package) — this only needs to prove this
 * component calls it with the right URL and renders what it returns, not
 * that the library itself draws a correct QR code.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CheckInGate } from "./CheckInGate";

// Deliberately returns the same opaque string regardless of input — a real
// QR-encoded PNG's base64 data never contains the source text readably
// either, so a mock that embedded it would make the "token never appears
// in the DOM" tests below pass for the wrong reason. What's actually
// exercised is that the component calls toDataURL with the right URL (see
// `toDataURL.mock.calls`/toHaveBeenCalledWith) and renders whatever it
// returns.
const toDataURL = vi.fn(async (_text: string, _opts?: unknown) => "data:image/png;base64,ZmFrZS1xci1kYXRh");
vi.mock("qrcode", () => ({
  default: { toDataURL: (text: string, opts?: unknown) => toDataURL(text, opts) },
}));

// jsdom's own default test URL — deliberately not stubbed/overridden:
// window.location in jsdom isn't safely reassignable, and the component
// under test only ever reads window.location.origin, so using whatever
// jsdom already provides is simpler and just as effective.
const ORIGIN = window.location.origin;

beforeEach(() => {
  toDataURL.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pageText(): string {
  return document.body.textContent ?? "";
}

function pageHtml(): string {
  return document.body.innerHTML;
}

describe("No token generated yet", () => {
  it("shows a short message, no QR, and no Show link control", async () => {
    render(<CheckInGate initialToken={null} />);

    expect(await screen.findByText(/no code generated yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show link/i })).not.toBeInTheDocument();
    expect(toDataURL).not.toHaveBeenCalled();
  });

  it("has no Print link either — nothing to print yet", () => {
    render(<CheckInGate initialToken={null} />);
    expect(screen.queryByRole("link", { name: /^print$/i })).not.toBeInTheDocument();
  });
});

describe("A token is already stored (page reload, not just right after generating)", () => {
  it("renders the QR for the current token immediately, with a generic alt text that never contains the token", async () => {
    render(<CheckInGate initialToken="existing-token-123" />);

    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("alt", expect.not.stringContaining("existing-token-123"));
    expect(img.getAttribute("alt")).toMatch(/qr code/i);
    expect(toDataURL).toHaveBeenCalledWith(
      `${ORIGIN}/?token=existing-token-123`,
      expect.anything(),
    );
    expect(screen.queryByText(/no code generated yet/i)).not.toBeInTheDocument();
  });

  it("shows a Print link to the separate printable view, opening in a new tab", async () => {
    render(<CheckInGate initialToken="existing-token-123" />);
    await screen.findByRole("img");

    const printLink = screen.getByRole("link", { name: /^print$/i });
    expect(printLink).toHaveAttribute("href", "/admin/security/print");
    expect(printLink).toHaveAttribute("target", "_blank");
  });

  it("never puts the token or the full link anywhere in the DOM until Show link is opened", async () => {
    render(<CheckInGate initialToken="existing-token-123" />);
    await screen.findByRole("img");

    expect(pageText()).not.toContain("existing-token-123");
    expect(pageHtml()).not.toContain("existing-token-123");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show link/i })).toBeInTheDocument();
  });

  it("Show link reveals the full URL in a selectable textarea with a Copy button; Hide link removes it again", async () => {
    render(<CheckInGate initialToken="existing-token-123" />);
    await screen.findByRole("img");

    fireEvent.click(screen.getByRole("button", { name: /show link/i }));

    const textarea = await screen.findByRole("textbox");
    expect(textarea).toHaveValue(`${ORIGIN}/?token=existing-token-123`);
    expect(textarea).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /^copy$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide link/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /hide link/i }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show link/i })).toBeInTheDocument();
  });

  it("starts collapsed again on a fresh render, even though a previous instance had it open", async () => {
    const { unmount } = render(<CheckInGate initialToken="existing-token-123" />);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: /show link/i }));
    await screen.findByRole("textbox");
    unmount();

    render(<CheckInGate initialToken="existing-token-123" />);
    await screen.findByRole("img");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show link/i })).toBeInTheDocument();
  });
});

describe("Generate New Code", () => {
  it("fetches a new token, swaps the QR to it, and re-collapses the link", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: "brand-new-token" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<CheckInGate initialToken="existing-token-123" />);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: /show link/i }));
    await screen.findByRole("textbox");

    fireEvent.click(screen.getByRole("button", { name: /generate new code/i }));

    await screen.findByText((_, el) => el?.textContent === "Generate New Code"); // button re-settles
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/checkin-gate/generate", { method: "POST" });
    expect(toDataURL).toHaveBeenCalledWith(`${ORIGIN}/?token=brand-new-token`, expect.anything());
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); // link collapses again on a fresh generate
    expect(pageText()).not.toContain("brand-new-token");
  });
});
