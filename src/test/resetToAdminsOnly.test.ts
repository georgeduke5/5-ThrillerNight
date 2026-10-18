/**
 * "Reset to admins only" against the real GoogleSheetsDataStore and an
 * in-memory, stateful fake of the Sheets API (reads see earlier writes):
 * batched writes, orphan cleanup, the write lock, partial failure, and
 * re-running to finish.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabs: Record<string, string[][]> = {};
let writeRequests: { kind: "update" | "append" | "batchUpdate"; tabs: string[] }[];
/** Runs before each values.batchUpdate is applied; may throw to simulate a Sheets failure. */
let beforeBatchUpdate: (() => void) | null;

const GUEST_HEADERS = [
  "id", "firstName", "lastName", "bracket", "photoRef", "photoUrl", "source", "createdAt",
  "groupId", "phone", "checkedInAt", "pendingApprovalAt", "isAdmin",
];
const GROUP_HEADERS = ["id", "name", "photoRef", "photoUrl", "memberIds", "createdAt", "creatorGuestId", "pendingMemberIds"];
const VOTE_HEADERS = ["voterGuestId", "category", "nomineeId", "timestamp"];

const GEORGE = "00000000-0000-0000-0000-00000000a001";
const SARAH = "00000000-0000-0000-0000-00000000a002";
const GUEST1 = "00000000-0000-0000-0000-00000000b001";
const GUEST2 = "00000000-0000-0000-0000-00000000b002";
const ADMIN_GROUP = "00000000-0000-0000-0000-00000000c001";
const GUEST_GROUP = "00000000-0000-0000-0000-00000000c002";

function row(headers: string[], values: Record<string, string>) {
  return headers.map((h) => values[h] ?? "");
}
function tabOf(range: string) {
  return range.split("!")[0]!;
}
function rowIndexOf(range: string) {
  return Number(/!A(\d+):/.exec(range)![1]) - 2;
}
function liveRows(tab: string) {
  return (tabs[tab] ?? []).filter((r) => r.some((c) => c !== ""));
}

beforeEach(() => {
  writeRequests = [];
  beforeBatchUpdate = null;
  tabs.Guests = [
    row(GUEST_HEADERS, { id: GEORGE, firstName: "George", lastName: "Duke", isAdmin: "true", photoRef: "photo-george", groupId: ADMIN_GROUP, checkedInAt: "2026-10-31T19:00:00.000Z" }),
    row(GUEST_HEADERS, { id: SARAH, firstName: "Sarah", lastName: "Duke", isAdmin: "TRUE", groupId: ADMIN_GROUP }),
    row(GUEST_HEADERS, { id: GUEST1, firstName: "Gus", lastName: "Est", photoRef: "photo-gus", groupId: ADMIN_GROUP }),
    row(GUEST_HEADERS, { id: GUEST2, firstName: "Gia", lastName: "Est", photoRef: "photo-gia", groupId: GUEST_GROUP }),
  ];
  tabs.Groups = [
    row(GROUP_HEADERS, {
      id: ADMIN_GROUP, name: "Dukes", photoRef: "photo-dukes",
      memberIds: `${GEORGE},${SARAH},${GUEST1}`, creatorGuestId: GUEST1, pendingMemberIds: GUEST2,
    }),
    row(GROUP_HEADERS, { id: GUEST_GROUP, name: "Ghostbusters", photoRef: "photo-ghostbusters", memberIds: GUEST2, creatorGuestId: GUEST2 }),
  ];
  tabs.Votes = [
    row(VOTE_HEADERS, { voterGuestId: GUEST1, category: "best", nomineeId: GUEST2, timestamp: "2026-10-31T20:00:00.000Z" }),
    row(VOTE_HEADERS, { voterGuestId: GEORGE, category: "best", nomineeId: GUEST_GROUP, timestamp: "2026-10-31T20:00:00.000Z" }),
  ];
  tabs.CandyGuesses = [[GUEST1, "Gus Est", "42", "2026-10-31T20:00:00.000Z"]];
  tabs.Passkeys = [
    [GEORGE, "cred-g", "pk", "0", "", "2026-10-31T19:00:00.000Z"],
    [GUEST1, "cred-1", "pk", "0", "", "2026-10-31T19:00:00.000Z"],
  ];
  tabs.Settings = [["votingOpen", "true"]];

  vi.resetModules();
  vi.doMock("@/lib/data-access/google-sheets/sheetsClient", () => ({
    getSheetsClient: vi.fn(async () => ({
      spreadsheets: {
        values: {
          get: vi.fn(async (req: { range: string }) => ({ data: { values: (tabs[tabOf(req.range)] ?? []).map((r) => [...r]) } })),
          append: vi.fn(async (req: { range: string; requestBody: { values: string[][] } }) => {
            writeRequests.push({ kind: "append", tabs: [tabOf(req.range)] });
            (tabs[tabOf(req.range)] ??= []).push(...req.requestBody.values);
            return {};
          }),
          update: vi.fn(async (req: { range: string; requestBody: { values: string[][] } }) => {
            writeRequests.push({ kind: "update", tabs: [tabOf(req.range)] });
            tabs[tabOf(req.range)]![rowIndexOf(req.range)] = req.requestBody.values[0]!;
            return {};
          }),
          batchUpdate: vi.fn(async (req: { requestBody: { data: { range: string; values: string[][] }[] } }) => {
            beforeBatchUpdate?.();
            writeRequests.push({ kind: "batchUpdate", tabs: [...new Set(req.requestBody.data.map((d) => tabOf(d.range)))] });
            for (const d of req.requestBody.data) tabs[tabOf(d.range)]![rowIndexOf(d.range)] = d.values[0]!;
            return {};
          }),
        },
      },
    })),
    getSpreadsheetId: vi.fn(() => "fake-spreadsheet-id"),
  }));
});

afterEach(() => {
  vi.doUnmock("@/lib/data-access/google-sheets/sheetsClient");
  vi.resetModules();
});

async function newStore() {
  const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
  return new GoogleSheetsDataStore();
}

const setting = (key: string) => tabs.Settings!.find((r) => r[0] === key)?.[1];

describe("resetToAdminsOnly", () => {
  it("keeps every isAdmin row untouched and wipes everything else in ONE batched write", async () => {
    const store = await newStore();
    const adminRowsBefore = tabs.Guests!.slice(0, 2).map((r) => [...r]);
    const report = await store.resetToAdminsOnly({ deletePhoto: async () => {}, graceMs: 0 });

    expect(report.complete).toBe(true);
    expect(report.adminsKept).toEqual(["George Duke", "Sarah Duke"]);
    expect(liveRows("Guests")).toEqual(adminRowsBefore);
    expect(liveRows("Votes")).toEqual([]);
    expect(liveRows("CandyGuesses")).toEqual([]);
    // Admins keep their passkeys; everyone else's are gone.
    expect(liveRows("Passkeys").map((r) => r[0])).toEqual([GEORGE]);

    const dataWrites = writeRequests.filter((w) => !w.tabs.every((t) => t === "Settings"));
    expect(dataWrites).toEqual([
      { kind: "batchUpdate", tabs: ["Guests", "Votes", "CandyGuesses", "Passkeys", "Groups"] },
    ]);
    expect(report.wiped).toEqual({
      guests: 2, votes: 2, candyGuesses: 1, passkeys: 1, groupsDeleted: 1, groupsCleaned: 1, photosDeleted: 3,
    });
    expect(report.remaining).toEqual({ guests: 0, votes: 0, candyGuesses: 0, passkeys: 0, groupsDeleted: 0, groupsCleaned: 0 });
  });

  it("deletes a group with no admin left (so it's off the ballot) and strips deleted guests from the rest", async () => {
    const store = await newStore();
    await store.resetToAdminsOnly({ deletePhoto: async () => {}, graceMs: 0 });
    const groups = await store.getGroups();
    expect(groups.map((g) => g.id)).toEqual([ADMIN_GROUP]);
    expect(groups[0]).toMatchObject({ memberIds: [GEORGE, SARAH], pendingMemberIds: [], creatorGuestId: null });
  });

  it("deletes deleted guests' and groups' photo files, never an admin's", async () => {
    const deleted: string[] = [];
    const store = await newStore();
    await store.resetToAdminsOnly({ deletePhoto: async (ref) => void deleted.push(ref), graceMs: 0 });
    expect(deleted.sort()).toEqual(["photo-ghostbusters", "photo-gia", "photo-gus"]);
  });

  it("reports photo files it couldn't delete as incomplete, by file id", async () => {
    const store = await newStore();
    const report = await store.resetToAdminsOnly({
      deletePhoto: async (ref) => {
        if (ref === "photo-gus") throw new Error("drive down");
      },
      graceMs: 0,
    });
    expect(report.complete).toBe(false);
    expect(report.photosNotDeleted).toEqual(["photo-gus"]);
    expect(liveRows("Guests")).toHaveLength(2);
  });

  it("signs everyone out and lifts the pause", async () => {
    const store = await newStore();
    const before = Date.now();
    const report = await store.resetToAdminsOnly({ graceMs: 0 });
    expect(report.signedOut).toBe(true);
    expect(Number(setting("allSessionsInvalidBefore"))).toBeGreaterThanOrEqual(before);
    expect(setting("resetInProgressSince")).toBe("");
    expect(report.allGuestIds.sort()).toEqual([GEORGE, SARAH, GUEST1, GUEST2].sort());
  });

  it("when the wipe fails, says what's still there, still signs everyone out, and a re-run finishes it", async () => {
    beforeBatchUpdate = () => {
      throw new Error("Quota exceeded");
    };
    const store = await newStore();
    const failed = await store.resetToAdminsOnly({ graceMs: 0 });

    expect(failed.complete).toBe(false);
    expect(failed.steps.find((s) => s.step === "Delete guest data")).toMatchObject({ ok: false });
    expect(failed.remaining).toMatchObject({ guests: 2, votes: 2, candyGuesses: 1, passkeys: 1 });
    expect(failed.signedOut).toBe(true);
    expect(setting("resetInProgressSince")).toBe("");

    beforeBatchUpdate = null;
    const rerun = await store.resetToAdminsOnly({ graceMs: 0 });
    expect(rerun.complete).toBe(true);
    expect(liveRows("Guests")).toHaveLength(2);
  });

  it("catches rows that land after the first pass, in a second pass", async () => {
    let first = true;
    beforeBatchUpdate = () => {
      if (!first) return;
      first = false;
      // A vote that got past the lock check just before the lock was taken.
      tabs.Votes!.push(row(VOTE_HEADERS, { voterGuestId: GUEST2, category: "late", nomineeId: GUEST1, timestamp: "x" }));
    };
    const store = await newStore();
    const report = await store.resetToAdminsOnly({ graceMs: 0 });
    expect(report.complete).toBe(true);
    expect(liveRows("Votes")).toEqual([]);
    expect(report.wiped.votes).toBe(3);
  });

  it("blocks walk-ins, votes, and group changes while it runs, then lets them through again", async () => {
    const store = await newStore();
    const { ResetInProgressError } = await import("@/lib/errors");
    let duringReset: unknown[] = [];
    beforeBatchUpdate = () => {
      beforeBatchUpdate = null;
      // Can't await inside the fake, so collect the promises and check below.
      duringReset = [
        store.addGuest({ firstName: "Late", lastName: "Comer", bracket: "adult-male", source: "walk-in" }).catch((e) => e),
        store.recordVote({ voterGuestId: GEORGE, category: "best", nomineeId: SARAH }).catch((e) => e),
        store.updateGroup(ADMIN_GROUP, { name: "Renamed" }).catch((e) => e),
      ];
    };
    await store.resetToAdminsOnly({ graceMs: 0 });
    const results = await Promise.all(duringReset);
    expect(results).toHaveLength(3);
    for (const r of results) expect(r).toBeInstanceOf(ResetInProgressError);
    expect(liveRows("Guests")).toHaveLength(2);

    await store.addGuest({ firstName: "After", lastName: "Reset", bracket: "adult-male", source: "walk-in" });
    expect(liveRows("Guests")).toHaveLength(3);
  });

  it("a lock left behind by a crashed reset stops blocking after 2 minutes", async () => {
    const store = await newStore();
    const { ResetInProgressError } = await import("@/lib/errors");
    tabs.Settings!.push(["resetInProgressSince", String(Date.now() - 30_000)]);
    await expect(
      store.addGuest({ firstName: "A", lastName: "B", bracket: "adult-male", source: "walk-in" }),
    ).rejects.toBeInstanceOf(ResetInProgressError);

    tabs.Settings![tabs.Settings!.length - 1] = ["resetInProgressSince", String(Date.now() - 3 * 60_000)];
    await expect(
      store.addGuest({ firstName: "A", lastName: "B", bracket: "adult-male", source: "walk-in" }),
    ).resolves.toMatchObject({ firstName: "A" });
  });
});

describe("deleteGuest", () => {
  it("also clears the guest out of other groups' join requests and creator field", async () => {
    const store = await newStore();
    await store.deleteGuest(GUEST1);
    const dukes = (await store.getGroups()).find((g) => g.id === ADMIN_GROUP)!;
    expect(dukes.memberIds).toEqual([GEORGE, SARAH]);
    expect(dukes.creatorGuestId).toBeNull();

    await store.deleteGuest(GUEST2);
    const after = (await store.getGroups()).find((g) => g.id === ADMIN_GROUP)!;
    expect(after.pendingMemberIds).toEqual([]);
  });
});
