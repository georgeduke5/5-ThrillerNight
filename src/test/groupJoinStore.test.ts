/**
 * GoogleSheetsDataStore's group-join rules against an in-memory, stateful
 * fake of the Sheets API: joining on your own is only ever a request, and
 * only the group's creator (or an admin) turns it into membership.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tabs: Record<string, string[][]> = {};

const GUEST_HEADERS = [
  "id", "firstName", "lastName", "bracket", "photoRef", "photoUrl", "source", "createdAt",
  "groupId", "phone", "checkedInAt", "pendingApprovalAt", "isAdmin",
];
const GROUP_HEADERS = ["id", "name", "photoRef", "photoUrl", "memberIds", "createdAt", "creatorGuestId", "pendingMemberIds"];

const CREATOR = "00000000-0000-0000-0000-0000000000a1";
const JOINER = "00000000-0000-0000-0000-0000000000a2";
const MEMBER = "00000000-0000-0000-0000-0000000000a3";
const GROUP = "00000000-0000-0000-0000-0000000000b1";
const OTHER_GROUP = "00000000-0000-0000-0000-0000000000b2";

function row(headers: string[], values: Record<string, string>) {
  return headers.map((h) => values[h] ?? "");
}
function tabOf(range: string) {
  return range.split("!")[0]!;
}
function rowIndexOf(range: string) {
  return Number(/!A(\d+):/.exec(range)![1]) - 2;
}

beforeEach(() => {
  tabs.Guests = [
    row(GUEST_HEADERS, { id: CREATOR, firstName: "C", lastName: "R", bracket: "adult-male", groupId: GROUP }),
    row(GUEST_HEADERS, { id: JOINER, firstName: "J", lastName: "O", bracket: "adult-male" }),
    row(GUEST_HEADERS, { id: MEMBER, firstName: "M", lastName: "E", bracket: "adult-male", groupId: GROUP }),
  ];
  tabs.Groups = [
    row(GROUP_HEADERS, { id: GROUP, name: "Ghostbusters", memberIds: `${CREATOR},${MEMBER}`, creatorGuestId: CREATOR }),
    row(GROUP_HEADERS, { id: OTHER_GROUP, name: "Others", memberIds: "", creatorGuestId: "" }),
  ];
  vi.resetModules();
  vi.doMock("@/lib/data-access/google-sheets/sheetsClient", () => ({
    getSheetsClient: vi.fn(async () => ({
      spreadsheets: {
        values: {
          get: vi.fn(async (req: { range: string }) => ({ data: { values: (tabs[tabOf(req.range)] ?? []).map((r) => [...r]) } })),
          append: vi.fn(async (req: { range: string; requestBody: { values: string[][] } }) => {
            (tabs[tabOf(req.range)] ??= []).push(...req.requestBody.values);
            return {};
          }),
          update: vi.fn(async (req: { range: string; requestBody: { values: string[][] } }) => {
            tabs[tabOf(req.range)]![rowIndexOf(req.range)] = req.requestBody.values[0]!;
            return {};
          }),
          batchUpdate: vi.fn(async (req: { requestBody: { data: { range: string; values: string[][] }[] } }) => {
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

describe("group join requests", () => {
  it("joining on your own can't go through the direct-add path", async () => {
    const store = await newStore();
    await expect(store.addGuestToGroup(GROUP, JOINER, JOINER)).rejects.toThrow(/Only current group members/);
  });

  it("a request records the guest as pending, not a member, and doesn't set their groupId", async () => {
    const store = await newStore();
    const group = await store.requestToJoinGroup(GROUP, JOINER);
    expect(group.pendingMemberIds).toEqual([JOINER]);
    expect(group.memberIds).not.toContain(JOINER);
    expect((await store.getGuestById(JOINER, { fresh: true }))?.groupId).toBeNull();
  });

  it("only one open request at a time", async () => {
    const store = await newStore();
    await store.requestToJoinGroup(GROUP, JOINER);
    await expect(store.requestToJoinGroup(OTHER_GROUP, JOINER)).rejects.toThrow(/already have a request/);
  });

  it("a member who isn't the creator can't approve; the creator can, which makes them a member", async () => {
    const store = await newStore();
    await store.requestToJoinGroup(GROUP, JOINER);
    await expect(store.resolveGroupJoinRequest(GROUP, JOINER, MEMBER, true)).rejects.toThrow(/creator/);
    await expect(store.resolveGroupJoinRequest(GROUP, JOINER, JOINER, true)).rejects.toThrow(/creator/);

    const group = await store.resolveGroupJoinRequest(GROUP, JOINER, CREATOR, true);
    expect(group.memberIds).toContain(JOINER);
    expect(group.pendingMemberIds).toEqual([]);
    expect((await store.getGuestById(JOINER, { fresh: true }))?.groupId).toBe(GROUP);
  });

  it("a member can still add someone directly, no approval needed", async () => {
    const store = await newStore();
    const group = await store.addGuestToGroup(GROUP, JOINER, MEMBER);
    expect(group.memberIds).toContain(JOINER);
  });
});

describe("resetGuestsToPending", () => {
  it("clears checkedInAt and sets pendingApprovalAt, even for an already-checked-in guest", async () => {
    tabs.Guests![1] = row(GUEST_HEADERS, { id: JOINER, firstName: "J", lastName: "O", bracket: "adult-male", checkedInAt: "2026-10-31T19:00:00.000Z" });
    const store = await newStore();
    await store.resetGuestsToPending([JOINER]);
    const g = await store.getGuestById(JOINER, { fresh: true });
    expect(g?.checkedInAt).toBeNull();
    expect(g?.pendingApprovalAt).not.toBeNull();
  });
});
