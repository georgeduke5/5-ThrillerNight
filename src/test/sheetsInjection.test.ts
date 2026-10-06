/**
 * Audits every place user-supplied input could influence how Google
 * Sheets is queried or addressed. Three layers, each proven directly:
 *
 * 1. The shared boundary validators (isValidId / isValidShortText) reject
 *    or safely tolerate a battery of hostile strings — quotes,
 *    apostrophes, exclamation marks, colons, commas, newlines, very long
 *    strings, and literal range-like text ("Sheet1!A1:Z999").
 * 2. SheetTable — the only place in the app that builds an A1-notation
 *    range — is driven with a real instance (mocked only at the Sheets
 *    API client boundary) to prove hostile row *content* never leaks into
 *    the *range* string sent to the API, regardless of what's being
 *    stored.
 * 3. A representative set of API routes reject a hostile/malformed
 *    guestId or groupId before ever calling into the DataStore, and pass
 *    a hostile-but-valid-length name through untouched as inert data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidId, isValidShortText, MAX_SHORT_TEXT_LENGTH } from "@/lib/validation";
import type { DataStore, Guest, NewGuest } from "@/lib/data-access";

const REAL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

/** Every character class the audit was asked to check, plus literal range-shaped text. */
const HOSTILE_STRINGS = [
  "O'Brien", // apostrophe
  '"quoted"', // double quotes
  "exciting!", // exclamation mark
  "a:b", // colon
  "a,b,c", // comma
  "line1\nline2", // newline
  "Sheet1!A1:Z999", // range-like text
  "'; DROP TABLE Guests; --", // classic injection shape, for good measure
];

// --- Mocks for the "API routes reject hostile ids" suite below ---
// vi.mock calls are hoisted to module scope by Vitest regardless of where
// they're written, so the variables their factories close over must live
// at module scope too, not inside a describe/beforeEach — see ADMIN,
// currentSessionGuestId, and fakeStore just below.
let currentSessionGuestId: string | null = null;
let fakeStore: DataStore;

const ADMIN: Guest = {
  id: "admin-1",
  firstName: "Ada",
  lastName: "Min",
  bracket: "adult-male",
  photoRef: null,
  photoUrl: null,
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  phone: null,
  checkedInAt: "2026-01-01T00:00:00.000Z",
  pendingApprovalAt: null,
  isAdmin: true,
};

vi.mock("@/lib/auth/voterSession", () => ({
  VOTER_SESSION_COOKIE: "tn_voter_session",
  VOTER_SESSION_MAX_AGE_SECONDS: 43200,
  getSessionGuestId: vi.fn(async () => currentSessionGuestId),
  getVoterSessionPayload: vi.fn(async () => null),
  resolveSessionGuestId: vi.fn(() => null),
  hasSessionFor: vi.fn(() => false),
  createVoterSessionToken: vi.fn(() => "mock-session-token"),
  switchActiveSessionToken: vi.fn(() => "mock-session-token"),
}));

vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

describe("isValidId", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidId(REAL_ID)).toBe(true);
  });

  it("rejects every hostile string", () => {
    for (const hostile of HOSTILE_STRINGS) {
      expect(isValidId(hostile)).toBe(false);
    }
  });

  it("rejects a real UUID padded with a range-like suffix, whitespace, or a trailing quote", () => {
    expect(isValidId(`${REAL_ID}!A1:Z999`)).toBe(false);
    expect(isValidId(`${REAL_ID}\n`)).toBe(false);
    expect(isValidId(` ${REAL_ID}`)).toBe(false);
    expect(isValidId(`${REAL_ID}'`)).toBe(false);
  });

  it("rejects a very long string", () => {
    expect(isValidId("a".repeat(10_000))).toBe(false);
  });

  it("rejects non-string, empty, and wrong-shape values", () => {
    expect(isValidId(undefined)).toBe(false);
    expect(isValidId(null)).toBe(false);
    expect(isValidId(123)).toBe(false);
    expect(isValidId("")).toBe(false);
    expect(isValidId({})).toBe(false);
    expect(isValidId([REAL_ID])).toBe(false);
  });
});

describe("isValidShortText", () => {
  it("accepts hostile-looking but legitimate characters as inert text (never special-cased)", () => {
    for (const hostile of HOSTILE_STRINGS) {
      expect(isValidShortText(hostile)).toBe(true);
    }
  });

  it("rejects an empty or whitespace-only string", () => {
    expect(isValidShortText("")).toBe(false);
    expect(isValidShortText("   ")).toBe(false);
    expect(isValidShortText("\n\n")).toBe(false);
  });

  it("accepts exactly the max length and rejects one character over", () => {
    expect(isValidShortText("a".repeat(MAX_SHORT_TEXT_LENGTH))).toBe(true);
    expect(isValidShortText("a".repeat(MAX_SHORT_TEXT_LENGTH + 1))).toBe(false);
  });

  it("rejects a very long string", () => {
    expect(isValidShortText("a".repeat(10_000))).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidShortText(undefined)).toBe(false);
    expect(isValidShortText(123)).toBe(false);
    expect(isValidShortText(null)).toBe(false);
  });
});

describe("GoogleSheetsDataStore's guestToRow / rowToGuest treat hostile names as inert data", () => {
  function makeGuest(overrides: Partial<Guest>): Guest {
    return {
      id: "guest-1",
      firstName: "Test",
      lastName: "Guest",
      bracket: "adult-male",
      photoRef: null,
      photoUrl: null,
      source: "manual",
      createdAt: "2026-01-01T00:00:00.000Z",
      groupId: null,
      phone: null,
      checkedInAt: null,
      pendingApprovalAt: null,
      isAdmin: false,
      ...overrides,
    };
  }

  it.each(HOSTILE_STRINGS)("round-trips a hostile firstName (%s) byte-for-byte", async (hostile) => {
    const { guestToRow, rowToGuest } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const row = guestToRow(makeGuest({ firstName: hostile }));
    expect(row.firstName).toBe(hostile); // none of these start with a formula-trigger char
    expect(rowToGuest(row).firstName).toBe(hostile);
    // Storing a hostile name never touches any other column.
    expect(row.id).toBe("guest-1");
    expect(row.bracket).toBe("adult-male");
  });
});

describe("SheetTable: row content never influences the A1-notation range it builds", () => {
  type FakeRow = { id: string; name: string };
  let getCalls: Array<{ spreadsheetId: string; range: string }>;
  let updateCalls: Array<{ spreadsheetId: string; range: string; requestBody: { values: string[][] } }>;
  let appendCalls: Array<{ spreadsheetId: string; range: string; requestBody: { values: string[][] } }>;

  beforeEach(() => {
    getCalls = [];
    updateCalls = [];
    appendCalls = [];
    vi.resetModules();
    vi.doMock("@/lib/data-access/google-sheets/sheetsClient", () => ({
      getSheetsClient: vi.fn(async () => ({
        spreadsheets: {
          values: {
            get: vi.fn(async (req: { spreadsheetId: string; range: string }) => {
              getCalls.push(req);
              return { data: { values: [] } };
            }),
            update: vi.fn(async (req: (typeof updateCalls)[number]) => {
              updateCalls.push(req);
              return {};
            }),
            append: vi.fn(async (req: (typeof appendCalls)[number]) => {
              appendCalls.push(req);
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

  it("getAllRows always requests the same fixed range", async () => {
    const { SheetTable } = await import("@/lib/data-access/google-sheets/SheetTable");
    const table = new SheetTable<FakeRow>("Guests", ["id", "name"]);
    await table.getAllRows();

    expect(getCalls).toHaveLength(1);
    expect(getCalls[0]!.spreadsheetId).toBe("fake-spreadsheet-id");
    expect(getCalls[0]!.range).toBe("Guests!A2:B");
  });

  it.each(HOSTILE_STRINGS)("updateRow's range never incorporates a hostile row value (%s)", async (hostile) => {
    const { SheetTable } = await import("@/lib/data-access/google-sheets/SheetTable");
    const table = new SheetTable<FakeRow>("Guests", ["id", "name"]);
    await table.updateRow(7, { id: hostile, name: hostile });

    expect(updateCalls).toHaveLength(1);
    // The range is still exactly what row 7's fixed-width range would be —
    // never anything derived from `hostile`.
    expect(updateCalls[0]!.range).toBe("Guests!A7:B7");
    // The hostile string shows up only as literal cell data.
    expect(updateCalls[0]!.requestBody.values).toEqual([[hostile, hostile]]);
  });

  it.each(HOSTILE_STRINGS)("appendRow's range never incorporates a hostile row value (%s)", async (hostile) => {
    const { SheetTable } = await import("@/lib/data-access/google-sheets/SheetTable");
    const table = new SheetTable<FakeRow>("Guests", ["id", "name"]);
    await table.appendRow({ id: hostile, name: hostile });

    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.range).toBe("Guests!A1");
    expect(appendCalls[0]!.requestBody.values).toEqual([[hostile, hostile]]);
  });

  it("a hostile tab name would be the only thing that could ever change the range — and it's never user-supplied", async () => {
    // Every SheetTable instance in GoogleSheetsDataStore.ts is constructed
    // with a literal string ("Guests", "Votes", "Groups", "Settings",
    // "Passkeys", "CandyGuesses") — never anything derived from a request.
    // This test documents that invariant directly: the tab name is a
    // constructor argument, never re-derived per call.
    const { SheetTable } = await import("@/lib/data-access/google-sheets/SheetTable");
    const table = new SheetTable<FakeRow>("Sheet1!A1:Z999", ["id", "name"]);
    await table.getAllRows();
    // Even a maximally hostile tab name is just concatenated literally —
    // proving range-building has no escaping/parsing step a crafted tab
    // name could exploit — but the real safety property is architectural:
    // nothing in this app ever constructs a SheetTable with anything but
    // one of the six fixed literal tab names above.
    expect(getCalls[0]!.range).toBe("Sheet1!A1:Z999!A2:B");
  });
});

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }) as never;
}

function paramsOf<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

describe("API routes reject hostile/malformed ids before the DataStore ever sees them", () => {
  beforeEach(() => {
    currentSessionGuestId = "admin-1";
    fakeStore = {
      getGuests: vi.fn(async () => [ADMIN]),
      getGuestById: vi.fn(async (id: string) => (id === "admin-1" ? ADMIN : null)),
      findGuestByName: vi.fn(async () => null),
      addGuest: vi.fn(async (g) => ({ ...ADMIN, id: "new-guest", ...g })),
      addGuests: vi.fn(async (gs: NewGuest[]) => gs.map((g, i) => ({ ...ADMIN, id: `new-guest-${i}`, ...g }))),
      updateGuest: vi.fn(async (id, updates) => ({ ...ADMIN, id, ...updates })),
      savePhotoReference: vi.fn(async () => {}),
      deleteGuest: vi.fn(async () => {}),
      markGuestCheckedIn: vi.fn(async () => {}),
      markGuestPendingApproval: vi.fn(async () => {}),
      approvePendingGuest: vi.fn(async () => {}),
      rejectPendingGuest: vi.fn(async () => {}),
      migratePlaintextPhones: vi.fn(async () => ({ migrated: 0, alreadyEncrypted: 0, skippedEmpty: 0 })),

      getGroups: vi.fn(async () => []),
      getGroupById: vi.fn(async () => null),
      addGroup: vi.fn(async (g) => ({ id: "group-1", name: g.name, photoRef: null, photoUrl: null, memberIds: [g.creatorGuestId], createdAt: "2026-01-01T00:00:00.000Z" })),
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

      getVotingStatus: vi.fn(async () => ({
        isOpen: true,
        resultsPublished: false,
        phoneVerificationEnabled: false,
        passkeyAuthEnabled: true,
        selfServiceWalkinEnabled: true,
      inPersonCheckInEnabled: true,
      })),
      setVotingOpen: vi.fn(async () => {}),
      setResultsPublished: vi.fn(async () => {}),
      setPhoneVerificationEnabled: vi.fn(async () => {}),
      setPasskeyAuthEnabled: vi.fn(async () => {}),
      setSelfServiceWalkinEnabled: vi.fn(async () => {}),
      setInPersonCheckInEnabled: vi.fn(async () => {}),

      recordCandyGuess: vi.fn(async (g) => ({ ...g, timestamp: "2026-01-01T00:00:00.000Z" })),
      getCandyGuesses: vi.fn(async () => []),
      getCandyGuessByGuestId: vi.fn(async () => null),

      getCandyCountStatus: vi.fn(async () => ({ guessingOpen: true, resultsPublished: false, trueCount: null })),
      setCandyGuessingOpen: vi.fn(async () => {}),
      setCandyResultsPublished: vi.fn(async () => {}),
      setCandyTrueCount: vi.fn(async () => {}),
    };
  });

  it.each(HOSTILE_STRINGS)("DELETE /api/guests/[id] rejects a hostile id (%s) without calling deleteGuest", async (hostile) => {
    const { DELETE } = await import("@/app/api/guests/[id]/route");
    const res = await DELETE(jsonRequest("http://localhost/api/guests/x", "DELETE"), paramsOf({ id: hostile }));
    expect(res.status).toBe(404);
    expect(fakeStore.deleteGuest).not.toHaveBeenCalled();
  });

  it.each(HOSTILE_STRINGS)("PATCH /api/guests/[id] rejects a hostile id (%s) without calling updateGuest", async (hostile) => {
    const { PATCH } = await import("@/app/api/guests/[id]/route");
    const res = await PATCH(
      jsonRequest("http://localhost/api/guests/x", "PATCH", { firstName: "New" }),
      paramsOf({ id: hostile }),
    );
    expect(res.status).toBe(404);
    expect(fakeStore.updateGuest).not.toHaveBeenCalled();
  });

  it.each(HOSTILE_STRINGS)("POST /api/admin/check-in rejects a hostile guestId (%s) without calling approvePendingGuest", async (hostile) => {
    const { POST } = await import("@/app/api/admin/check-in/route");
    const res = await POST(
      jsonRequest("http://localhost/api/admin/check-in", "POST", { guestId: hostile, action: "approve" }),
    );
    expect(res.status).toBe(400);
    expect(fakeStore.approvePendingGuest).not.toHaveBeenCalled();
  });

  it.each(HOSTILE_STRINGS)("DELETE /api/groups/[id]/members/[guestId] rejects hostile ids (%s) without calling removeGuestFromGroup", async (hostile) => {
    const { DELETE } = await import("@/app/api/groups/[id]/members/[guestId]/route");
    const res = await DELETE(
      jsonRequest("http://localhost/api/groups/x/members/y", "DELETE"),
      paramsOf({ id: hostile, guestId: "3fa85f64-5717-4562-b3fc-2c963f66afa6" }),
    );
    expect(res.status).toBe(404);
    expect(fakeStore.removeGuestFromGroup).not.toHaveBeenCalled();
  });

  it.each(HOSTILE_STRINGS)("POST /api/photos rejects a hostile guestId (%s) without calling getGuestById", async (hostile) => {
    const { POST } = await import("@/app/api/photos/route");
    const formData = new FormData();
    formData.set("file", new File([new Uint8Array([1, 2, 3])], "x.jpg", { type: "image/jpeg" }));
    formData.set("guestId", hostile);
    const request = new Request("http://localhost/api/photos", { method: "POST", body: formData }) as never;
    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(fakeStore.getGuestById).not.toHaveBeenCalled();
  });

  it.each(HOSTILE_STRINGS)("POST /api/guests accepts a hostile-but-valid-length name (%s) and passes it through unchanged", async (hostile) => {
    const { POST } = await import("@/app/api/guests/route");
    const res = await POST(
      jsonRequest("http://localhost/api/guests", "POST", {
        firstName: hostile,
        lastName: "Guest",
        bracket: "adult-male",
      }),
    );
    expect(res.status).toBe(201);
    expect(fakeStore.addGuest).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: hostile, lastName: "Guest" }),
    );
  });

  it("POST /api/guests rejects a name longer than the max length", async () => {
    const { POST } = await import("@/app/api/guests/route");
    const res = await POST(
      jsonRequest("http://localhost/api/guests", "POST", {
        firstName: "a".repeat(10_000),
        lastName: "Guest",
        bracket: "adult-male",
      }),
    );
    expect(res.status).toBe(400);
    expect(fakeStore.addGuest).not.toHaveBeenCalled();
  });
});
