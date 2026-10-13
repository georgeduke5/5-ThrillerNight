/**
 * /admin/vote-as/[guestId]/page.tsx — the "Vote for this guest" page
 * itself (see GuestManager.tsx's action of the same name and
 * /api/admin/vote-as/[guestId]/route.ts, the API route this page's
 * VotingApp instance talks to).
 *
 * Two things covered here:
 *
 * - Admin gating and id validation at the PAGE level: a non-admin is
 *   redirected to "/" (never shown even a blank/error version of this
 *   page), and a malformed or nonexistent guest id 404s — re-checked here
 *   independently of admin/(protected)/layout.tsx, same posture as the API
 *   route (see that file's own doc comment).
 * - Regression coverage for "Functions cannot be passed directly to Client
 *   Components" (see src/test/rscClientBoundaryProps.test.tsx, which this
 *   mirrors in a separate file rather than extending that one, so this
 *   page's admin/config mocks don't entangle with that file's own): calls
 *   the page function directly (a Server Component is just a function) and
 *   walks what it returns, asserting every prop landing on VotingApp — the
 *   one "use client" component this page renders — is plain,
 *   JSON-serializable data, in particular the `adminProxy` object this
 *   page is the only caller to ever set.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import type { DataStore, Guest } from "@/lib/data-access";
import { VotingApp } from "@/components/voting/VotingApp";

const REDIRECT_SENTINEL = new Error("NEXT_REDIRECT");
const NOT_FOUND_SENTINEL = new Error("NEXT_NOT_FOUND");
const redirectMock = vi.fn((_path: string) => {
  throw REDIRECT_SENTINEL;
});
const notFoundMock = vi.fn(() => {
  throw NOT_FOUND_SENTINEL;
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
  notFound: () => notFoundMock(),
}));

let isAdmin = false;
vi.mock("@/lib/auth/adminAccess", () => ({
  isAdminRequest: vi.fn(async () => isAdmin),
}));

vi.mock("@/lib/config", () => ({
  getSiteConfig: () => ({
    features: { votingModuleEnabled: true },
    voting: { categories: [{ id: "best-adult-male-costume", label: "Best Adult Male Costume", bracket: "adult-male" }] },
    theme: { placeholderImage: "/placeholder.png" },
  }),
}));

function makeGuest(overrides: Partial<Guest>): Guest {
  return {
    id: "unset",
    firstName: "Test",
    lastName: "Guest",
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
    ...overrides,
  };
}

const TARGET_ID = "00000000-0000-0000-0000-00000000b1b1";
const NONEXISTENT_ID = "00000000-0000-0000-0000-00000000ffff";
const MALFORMED_ID = "not-a-uuid";
const TARGET_GUEST = makeGuest({ id: TARGET_ID, firstName: "Gus", lastName: "Est" });

const getGuestById = vi.fn(async (id: string) => (id === TARGET_ID ? TARGET_GUEST : null));
vi.mock("@/lib/data-access", () => ({
  getDataStore: () => ({ getGuestById } as unknown as DataStore),
}));

function paramsOf(guestId: string) {
  return { params: Promise.resolve({ guestId }) };
}

beforeEach(() => {
  isAdmin = false;
  redirectMock.mockClear();
  notFoundMock.mockClear();
  getGuestById.mockClear();
});

describe("admin authentication and id validation", () => {
  it("a non-admin is redirected to the public home page, never shown the page", async () => {
    isAdmin = false;
    const { default: AdminVoteAsPage } = await import("@/app/admin/(protected)/vote-as/[guestId]/page");
    await expect(AdminVoteAsPage(paramsOf(TARGET_ID))).rejects.toBe(REDIRECT_SENTINEL);
    expect(redirectMock).toHaveBeenCalledWith("/");
    // Never even looks up the guest for a non-admin.
    expect(getGuestById).not.toHaveBeenCalled();
  });

  it("a malformed guest id 404s for an admin", async () => {
    isAdmin = true;
    const { default: AdminVoteAsPage } = await import("@/app/admin/(protected)/vote-as/[guestId]/page");
    await expect(AdminVoteAsPage(paramsOf(MALFORMED_ID))).rejects.toBe(NOT_FOUND_SENTINEL);
  });

  it("a well-formed but nonexistent guest id 404s for an admin", async () => {
    isAdmin = true;
    const { default: AdminVoteAsPage } = await import("@/app/admin/(protected)/vote-as/[guestId]/page");
    await expect(AdminVoteAsPage(paramsOf(NONEXISTENT_ID))).rejects.toBe(NOT_FOUND_SENTINEL);
  });

  it("an admin with a valid, existing guest id renders without redirecting or 404ing", async () => {
    isAdmin = true;
    const { default: AdminVoteAsPage } = await import("@/app/admin/(protected)/vote-as/[guestId]/page");
    const element = await AdminVoteAsPage(paramsOf(TARGET_ID));
    expect(redirectMock).not.toHaveBeenCalled();
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(isValidElement(element)).toBe(true);
  });
});

describe("no function prop crosses the server/client boundary onto VotingApp", () => {
  function isPlainObject(value: object): boolean {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function assertPropIsSerializable(value: unknown, label: string): void {
    if (typeof value === "function") {
      throw new Error(`${label} is a function — this would reproduce the "Functions cannot be passed directly to Client Components" production error.`);
    }
    if (value instanceof Date || value instanceof Map || value instanceof Set || value instanceof RegExp) {
      throw new Error(`${label} is a ${value.constructor.name}, which isn't JSON-serializable across the RSC boundary.`);
    }
    if (isValidElement(value)) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => assertPropIsSerializable(item, `${label}[${i}]`));
      return;
    }
    if (value !== null && typeof value === "object") {
      if (!isPlainObject(value)) {
        throw new Error(`${label} is a ${value.constructor?.name ?? "class"} instance, not a plain serializable object.`);
      }
      for (const [key, nested] of Object.entries(value)) {
        assertPropIsSerializable(nested, `${label}.${key}`);
      }
    }
  }

  function findVotingAppElement(node: unknown): ReactElement<Record<string, unknown>> | null {
    if (node === null || node === undefined || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findVotingAppElement(child);
        if (found) return found;
      }
      return null;
    }
    if (!isValidElement(node)) return null;
    const element = node as ReactElement<Record<string, unknown>>;
    if (element.type === VotingApp) return element;
    const props = element.props ?? {};
    if ("children" in props) return findVotingAppElement(props.children);
    return null;
  }

  it("every prop landing on VotingApp (adminProxy included) is plain, serializable data", async () => {
    isAdmin = true;
    const { default: AdminVoteAsPage } = await import("@/app/admin/(protected)/vote-as/[guestId]/page");
    const tree = await AdminVoteAsPage(paramsOf(TARGET_ID));

    const votingAppElement = findVotingAppElement(tree);
    expect(votingAppElement).not.toBeNull();
    for (const [key, value] of Object.entries(votingAppElement!.props)) {
      assertPropIsSerializable(value, `<VotingApp ${key}>`);
    }
    expect(votingAppElement!.props.adminProxy).toEqual({ guestId: TARGET_ID, guestName: "Gus Est" });
  });
});
