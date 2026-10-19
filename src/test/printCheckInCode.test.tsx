// @vitest-environment jsdom
/**
 * /admin/security/print — the printable, admin-only check-in flyer reachable
 * from the "Print" link on /admin/security (see CheckInGate.test.tsx for
 * that link's own coverage). Two things matter here:
 *
 * - It requires the exact same admin authentication as every other /admin
 *   page (isAdminRequest(), re-checked here rather than inherited, since
 *   this route deliberately sits outside the admin/(protected) layout that
 *   normally does that check — see page.tsx's own doc comment for why).
 * - Once past that check, it renders nothing but PrintCheckInCode (the
 *   large heading + QR) — no AdminNav, no "Main Site" link, no stats, no
 *   Danger Zone — fed the current token via a fresh (not cached) read, the
 *   same DataStore method /admin/security's own page.tsx already uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DataStore } from "@/lib/data-access";
import { PrintCheckInCode } from "@/components/admin/PrintCheckInCode";

const REDIRECT_SENTINEL = new Error("NEXT_REDIRECT");
const redirectMock = vi.fn((_path: string) => {
  throw REDIRECT_SENTINEL;
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

let isAdmin = false;
vi.mock("@/lib/auth/adminAccess", () => ({
  isAdminRequest: vi.fn(async () => isAdmin),
}));

const getCheckInGateToken = vi.fn(async () => "current-live-token");
vi.mock("@/lib/data-access", () => ({
  getDataStore: () => ({ getCheckInGateToken } as unknown as DataStore),
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,ZmFrZS1xci1kYXRh") },
}));

beforeEach(() => {
  isAdmin = false;
  redirectMock.mockClear();
  getCheckInGateToken.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("admin authentication", () => {
  it("a non-admin (or unauthenticated) request is redirected to the public home page and never reads the token", async () => {
    isAdmin = false;
    const { default: PrintPage } = await import("@/app/admin/security/print/page");

    await expect(PrintPage()).rejects.toBe(REDIRECT_SENTINEL);
    expect(redirectMock).toHaveBeenCalledWith("/");
    expect(getCheckInGateToken).not.toHaveBeenCalled();
  });

  it("an admin request is not redirected", async () => {
    isAdmin = true;
    const { default: PrintPage } = await import("@/app/admin/security/print/page");

    const element = await PrintPage();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(isValidElement(element)).toBe(true);
  });
});

describe("page content, once past the admin check", () => {
  it("renders nothing but PrintCheckInCode — no admin nav, stats, or Danger Zone content", async () => {
    isAdmin = true;
    const { default: PrintPage } = await import("@/app/admin/security/print/page");

    const element = await PrintPage();
    expect(isValidElement(element)).toBe(true);
    // The page's ENTIRE return value is this one component — there is
    // nothing else in the tree (no AdminNav, no "Main Site" link, no
    // StatCard) for it to be wrapped in or alongside.
    expect((element as { type: unknown }).type).toBe(PrintCheckInCode);
    expect((element as { props: { token: string } }).props.token).toBe("current-live-token");
  });

  it("reads the current token fresh on every call — a token change between two loads is reflected, not cached", async () => {
    isAdmin = true;
    const { default: PrintPage } = await import("@/app/admin/security/print/page");

    const first = await PrintPage();
    expect((first as { props: { token: string } }).props.token).toBe("current-live-token");

    getCheckInGateToken.mockResolvedValueOnce("rotated-token-after-regenerate");
    const second = await PrintPage();
    expect((second as { props: { token: string } }).props.token).toBe("rotated-token-after-regenerate");
    expect(getCheckInGateToken).toHaveBeenCalledTimes(2);
  });
});

describe("PrintCheckInCode rendering", () => {
  it("shows the heading, the QR image, and nothing else chrome-wise", async () => {
    render(createElement(PrintCheckInCode, { token: "a-token" }));

    expect(await screen.findByRole("heading", { name: /^check-in$/i })).toBeInTheDocument();
    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("alt", expect.stringMatching(/qr code/i));
    // The visible text is exactly the heading, the instructions, and the
    // Print button — no nav links, stats, or other admin page chrome
    // anywhere in this tree.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
  });

  it("lists the four check-in steps, in order, below the QR code", async () => {
    render(createElement(PrintCheckInCode, { token: "a-token" }));
    await screen.findByRole("img");

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "Scan the code",
      "Enter the code we texted",
      "Create your passkey",
      "Take your costume photo",
    ]);
  });

  it("renders the instructions as a real <ol> with visible markers enabled — not a styling reset that strips them", async () => {
    render(createElement(PrintCheckInCode, { token: "a-token" }));
    await screen.findByRole("img");

    // role="list" alone would also match a <ul> with list-style:none (an
    // ARIA role survives that reset even though the numbers themselves
    // disappear) — the actual regression here was Tailwind's preflight
    // zeroing <ol>'s padding/list-style and `list-decimal` only restoring
    // the marker *type*, not a position that works without that padding
    // (see list-inside below), so the real assertion is on the element and
    // the classes that together put a visible, numbered marker on screen.
    const list = screen.getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(list.className).toMatch(/\blist-decimal\b/);
    expect(list.className).toMatch(/\blist-inside\b/);
  });

  it("the instruction list shares the QR image's exact width (and left edge) via a common wrapper, never wider", async () => {
    render(createElement(PrintCheckInCode, { token: "a-token" }));
    const img = await screen.findByRole("img");
    const list = screen.getByRole("list");

    // Both must be `w-full` relative to the SAME sized-and-positioned
    // wrapper — not independently sized/centered flex children of the
    // page's own root (the original bug: the list stretched to the full
    // page width while the QR stayed at its own fixed width, so neither
    // their widths nor their left edges lined up).
    const wrapper = img.parentElement;
    expect(wrapper).toBe(list.parentElement);
    expect(wrapper?.className).toMatch(/print:w-\[4in\]/);
    expect(wrapper?.className).toMatch(/items-start/);
    expect(img.className).toMatch(/\bw-full\b/);
    expect(list.className).toMatch(/\bw-full\b/);
  });

  it("with no token generated yet, shows a message and no QR or instructions", () => {
    render(createElement(PrintCheckInCode, { token: null }));

    expect(screen.getByText(/no code has been generated yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
