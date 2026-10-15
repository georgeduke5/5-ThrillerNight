/**
 * Regression coverage for "Functions cannot be passed directly to Client
 * Components" — a production-only error (see DangerZone.tsx's history: it
 * passed a `formatSuccess` function prop straight through to the "use
 * client" DangerZoneAction) that neither the existing unit tests nor
 * `next build` caught, because:
 *
 * - React Testing Library's render() mounts the whole tree as an ordinary
 *   client-side React render in jsdom — it never goes through RSC's
 *   server/client serialization boundary, so a function prop works fine
 *   there regardless of whether it's actually valid in production.
 * - TypeScript has no concept of "this prop crosses an RSC boundary and
 *   must be serializable" — a function-typed prop type-checks identically
 *   whether its component is "use client" or not.
 * - `next build` only *compiles* a force-dynamic page like /admin/security;
 *   it doesn't invoke the page function with real data, so the error only
 *   actually surfaces the first time a real request renders the page.
 *
 * This test closes that gap without needing Next's own RSC renderer: a
 * Server Component is just a plain (possibly async) function that returns
 * a React element tree, so calling AdminSecurityPage() directly and
 * walking what it returns — recursing into every other Server Component
 * function it renders, exactly like RSC rendering does — lets this inspect
 * the real props landing on every real "use client" component in the tree
 * and assert each one is plain, JSON-serializable data: no functions, no
 * class instances, no Map/Set/Date/RegExp. A React element itself (JSX
 * passed down as a prop, e.g. a `logo` slot) is explicitly fine — RSC
 * supports that.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement } from "react";
import type { CandyCountStatus, DataStore, Guest, VotingStatus } from "@/lib/data-access";
import { SecurityToggles } from "@/components/admin/SecurityToggles";
import { CheckInGate } from "@/components/admin/CheckInGate";
import { MigratePhoneEncryptionButton } from "@/components/admin/MigratePhoneEncryptionButton";
import { DangerZoneAction } from "@/components/admin/DangerZoneAction";

// Every "use client" component actually reachable from /admin/security's
// tree — the real RSC serialization boundary. Anything else encountered
// while walking is treated as a Server Component and called (recursed
// into) to find what *it* renders, the same way RSC rendering would.
const CLIENT_BOUNDARY_COMPONENTS = new Set<unknown>([
  SecurityToggles,
  CheckInGate,
  MigratePhoneEncryptionButton,
  DangerZoneAction,
]);

function componentName(type: unknown): string {
  if (typeof type === "function") return type.name || "anonymous";
  if (typeof type === "string") return type;
  return String(type);
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Throws with a message naming exactly which prop, on which component, isn't serializable — mirroring React's own "Functions cannot be passed directly to Client Components" class of error. */
function assertPropIsSerializable(value: unknown, label: string): void {
  if (typeof value === "function") {
    throw new Error(
      `${label} is a function. Functions cannot be passed from a Server Component to a Client ` +
        `Component — this reproduces the production-only "Functions cannot be passed directly to ` +
        `Client Components" error. Pass plain serializable data instead (e.g. a string the client ` +
        `component uses to build its own message/behavior).`,
    );
  }
  if (value instanceof Date || value instanceof Map || value instanceof Set || value instanceof RegExp) {
    throw new Error(`${label} is a ${value.constructor.name}, which isn't JSON-serializable across the RSC boundary.`);
  }
  if (isValidElement(value)) return; // a server-rendered React element (e.g. a `logo` slot) is explicitly fine
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

/**
 * Walks a server-rendered element tree, exactly like RSC rendering would:
 * for a known "use client" component, checks every prop it actually
 * received; for anything else that's a function component, calls it (a
 * Server Component is just a function) and recurses into what it returns.
 */
async function walk(node: unknown, path: string): Promise<void> {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    await Promise.all(node.map((child, i) => walk(child, `${path}[${i}]`)));
    return;
  }
  if (!isValidElement(node)) return;

  const element = node as ReactElement<Record<string, unknown>>;
  const type = element.type;
  const props = element.props ?? {};
  const name = componentName(type);

  if (typeof type === "function" && CLIENT_BOUNDARY_COMPONENTS.has(type)) {
    for (const [key, value] of Object.entries(props)) {
      if (key === "children") continue;
      assertPropIsSerializable(value, `${path} -> <${name} ${key}>`);
    }
    if ("children" in props) await walk(props.children, `${path} -> <${name}>.children`);
    return;
  }

  if (typeof type === "function") {
    // A Server Component (including locally-defined ones like StatCard) —
    // render it for real to discover what it renders, then keep walking.
    const rendered = await (type as (p: unknown) => unknown)(props);
    await walk(rendered, `${path} -> <${name}>()`);
    return;
  }

  // A plain host element (div, h1, ...) — nothing to check on it directly,
  // but its children might still contain Server/Client components.
  if ("children" in props) await walk(props.children, `${path}.children`);
}

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

const ALL_ENABLED: VotingStatus = {
  isOpen: true,
  resultsPublished: false,
  phoneVerificationEnabled: true,
  passkeyAuthEnabled: true,
  selfServiceWalkinEnabled: true,
  inPersonCheckInEnabled: true,
};
const CANDY_STATUS: CandyCountStatus = { guessingOpen: true, resultsPublished: false, trueCount: null };

function makeFakeStore(): DataStore {
  return {
    getGuests: vi.fn(async () => [makeGuest({ id: "guest-1", firstName: "Gus", lastName: "Est" })]),
    getGuestById: vi.fn(async () => null),
    findGuestByName: vi.fn(async () => null),
    addGuest: vi.fn(async (g) => makeGuest({ id: "new-guest", ...g })),
    addGuests: vi.fn(async () => []),
    updateGuest: vi.fn(async (id, updates) => makeGuest({ id, ...updates })),
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

    getGroups: vi.fn(async () => []),
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
    getVotes: vi.fn(async () => []),

    getPasskeyByGuestId: vi.fn(async () => null),
    getPasskeyByCredentialId: vi.fn(async () => null),
    getPasskeys: vi.fn(async () => []),
    savePasskey: vi.fn(async () => {}),
    updatePasskeyCounter: vi.fn(async () => {}),
    deletePasskey: vi.fn(async () => true),

    getVotingStatus: vi.fn(async () => ALL_ENABLED),
    setVotingOpen: vi.fn(async () => {}),
    setResultsPublished: vi.fn(async () => {}),
    setPhoneVerificationEnabled: vi.fn(async () => {}),
    setPasskeyAuthEnabled: vi.fn(async () => {}),
    setSelfServiceWalkinEnabled: vi.fn(async () => {}),
    setInPersonCheckInEnabled: vi.fn(async () => {}),

    recordCandyGuess: vi.fn(async (g) => ({ ...g, timestamp: "2026-01-01T00:00:00.000Z" })),
    getCandyGuesses: vi.fn(async () => []),
    getCandyGuessByGuestId: vi.fn(async () => null),

    getCandyCountStatus: vi.fn(async () => CANDY_STATUS),
    setCandyGuessingOpen: vi.fn(async () => {}),
    setCandyResultsPublished: vi.fn(async () => {}),
    setCandyTrueCount: vi.fn(async () => {}),

    getCheckInGateToken: vi.fn(async () => "existing-token-for-test"),
    setCheckInGateToken: vi.fn(async () => {}),

    clearVotesAndCandyGuesses: vi.fn(async () => ({ votesCleared: 0, guessesCleared: 0 })),
    deleteNonAdminPasskeys: vi.fn(async () => ({ deleted: 0, guestIds: [] })),
    getSessionsInvalidBefore: vi.fn(async () => null),
    setSessionsInvalidBefore: vi.fn(async () => {}),
    setAllSessionsInvalidBefore: vi.fn(async () => {}),
    getSessionInvalidationThresholds: vi.fn(async () => ({ sessionsInvalidBefore: null, allSessionsInvalidBefore: null })),
    resetToAdminsOnly: vi.fn(async () => ({
      guestsDeleted: 0,
      adminsKept: 0,
      votesCleared: 0,
      guessesCleared: 0,
      passkeysCleared: 0,
      allGuestIds: [],
    })),
  };
}

let fakeStore: DataStore;
vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

describe("/admin/security's server component tree never passes a non-serializable prop to a Client Component", () => {
  it("every prop landing on SecurityToggles, CheckInGate, MigratePhoneEncryptionButton, and DangerZoneAction is plain, serializable data", async () => {
    fakeStore = makeFakeStore();
    const { default: AdminSecurityPage } = await import("@/app/admin/(protected)/security/page");

    const tree = await AdminSecurityPage();
    await expect(walk(tree, "AdminSecurityPage()")).resolves.toBeUndefined();
  });

  it("sanity check: the walker actually detects a function prop crossing the boundary (so a regression here would fail loudly, not silently pass)", async () => {
    // A synthetic Server Component rendering a real "use client" component
    // with a deliberately bad function prop — the exact shape of the bug
    // this file guards against, reproduced directly rather than relying on
    // this app's current code staying broken to prove the check works.
    function BadServerComponent() {
      return createElement(DangerZoneAction, {
        buttonLabel: "x",
        heading: "x",
        description: "x",
        endpoint: "/api/x",
        kind: "reset-voting-data",
        onDone: () => {},
      } as never);
    }
    await expect(walk(BadServerComponent(), "sanity-check")).rejects.toThrow(/function/i);
  });
});
