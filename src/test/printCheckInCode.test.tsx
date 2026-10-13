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
  it("shows only the large heading and the QR image — no other text content", async () => {
    render(createElement(PrintCheckInCode, { token: "a-token" }));

    expect(await screen.findByRole("heading", { name: /check-in qr code/i })).toBeInTheDocument();
    const img = await screen.findByRole("img");
    expect(img).toHaveAttribute("alt", expect.stringMatching(/qr code/i));
    // The visible text is exactly the heading and the Print button — no
    // nav links, stats, or other admin page chrome anywhere in this tree.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/danger zone/i)).not.toBeInTheDocument();
  });

  it("with no token generated yet, shows a message and no QR", () => {
    render(createElement(PrintCheckInCode, { token: null }));

    expect(screen.getByText(/no code has been generated yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
