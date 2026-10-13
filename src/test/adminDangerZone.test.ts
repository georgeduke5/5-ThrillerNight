/**
 * Drives the REAL GoogleSheetsDataStore (only the Sheets API client itself
 * is mocked, same approach as sheetsInjection.test.ts's "SheetTable" suite)
 * for the three /admin/security Danger Zone operations, proving the actual
 * row-selection logic — not just that a route calls the right method name:
 *
 * - clearVotesAndCandyGuesses blanks every Votes and CandyGuesses row and
 *   nothing else (Guests, Groups, Settings, Passkeys all untouched).
 * - deleteNonAdminPasskeys blanks only the Passkeys rows belonging to a
 *   non-admin guest, leaving an admin's passkey row alone.
 * - resetToAdminsOnly blanks every non-admin Guests row (leaving admin
 *   Guests rows completely unwritten), and unconditionally blanks every
 *   Votes, CandyGuesses, and Passkeys row — including an admin's own —
 *   while never touching Groups or Settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SheetRow = { spreadsheetId: string; range: string; requestBody?: { values: string[][] } };

let getCalls: SheetRow[];
let updateCalls: SheetRow[];
let appendCalls: SheetRow[];

/** Tab name is always the text before "!" in an A1-notation range (see SheetTable.range). */
function tabOf(range: string): string {
  return range.split("!")[0]!;
}

const GUEST_HEADERS = [
  "id",
  "firstName",
  "lastName",
  "bracket",
  "photoRef",
  "photoUrl",
  "source",
  "createdAt",
  "groupId",
  "phone",
  "checkedInAt",
  "pendingApprovalAt",
  "isAdmin",
];
const VOTE_HEADERS = ["voterGuestId", "category", "nomineeId", "timestamp"];
const PASSKEY_HEADERS = ["guestId", "credentialId", "publicKey", "counter", "transports", "createdAt"];
const CANDY_GUESS_HEADERS = ["guestId", "guestName", "guess", "timestamp"];

function row(headers: string[], values: Record<string, string>): string[] {
  return headers.map((h) => values[h] ?? "");
}

const ADMIN_ID = "00000000-0000-0000-0000-00000000a001";
const GUEST1_ID = "00000000-0000-0000-0000-00000000b001";
const GUEST2_ID = "00000000-0000-0000-0000-00000000b002";

const GUEST_ROWS = [
  row(GUEST_HEADERS, { id: ADMIN_ID, firstName: "Ada", lastName: "Min", isAdmin: "true" }),
  row(GUEST_HEADERS, { id: GUEST1_ID, firstName: "Gus", lastName: "Est", isAdmin: "" }),
  row(GUEST_HEADERS, { id: GUEST2_ID, firstName: "Gia", lastName: "Est", isAdmin: "false" }),
];
const VOTE_ROWS = [
  row(VOTE_HEADERS, { voterGuestId: GUEST1_ID, category: "best-adult-male-costume", nomineeId: GUEST2_ID, timestamp: "2026-01-01T00:00:00.000Z" }),
  row(VOTE_HEADERS, { voterGuestId: GUEST2_ID, category: "best-adult-female-costume", nomineeId: GUEST1_ID, timestamp: "2026-01-01T00:00:00.000Z" }),
];
const CANDY_GUESS_ROWS = [
  row(CANDY_GUESS_HEADERS, { guestId: GUEST1_ID, guestName: "Gus Est", guess: "42", timestamp: "2026-01-01T00:00:00.000Z" }),
];
const PASSKEY_ROWS = [
  row(PASSKEY_HEADERS, { guestId: ADMIN_ID, credentialId: "admin-cred", publicKey: "pk-a", counter: "0", transports: "", createdAt: "2026-01-01T00:00:00.000Z" }),
  row(PASSKEY_HEADERS, { guestId: GUEST1_ID, credentialId: "guest1-cred", publicKey: "pk-1", counter: "0", transports: "", createdAt: "2026-01-01T00:00:00.000Z" }),
  row(PASSKEY_HEADERS, { guestId: GUEST2_ID, credentialId: "guest2-cred", publicKey: "pk-2", counter: "0", transports: "", createdAt: "2026-01-01T00:00:00.000Z" }),
];

beforeEach(() => {
  getCalls = [];
  updateCalls = [];
  appendCalls = [];
  vi.resetModules();
  vi.doMock("@/lib/data-access/google-sheets/sheetsClient", () => ({
    getSheetsClient: vi.fn(async () => ({
      spreadsheets: {
        values: {
          get: vi.fn(async (req: SheetRow) => {
            getCalls.push(req);
            const tab = tabOf(req.range);
            const byTab: Record<string, string[][]> = {
              Guests: GUEST_ROWS,
              Votes: VOTE_ROWS,
              CandyGuesses: CANDY_GUESS_ROWS,
              Passkeys: PASSKEY_ROWS,
              Groups: [],
              Settings: [],
            };
            return { data: { values: byTab[tab] ?? [] } };
          }),
          update: vi.fn(async (req: SheetRow) => {
            updateCalls.push(req);
            return {};
          }),
          append: vi.fn(async (req: SheetRow) => {
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

describe("clearVotesAndCandyGuesses", () => {
  it("blanks every Votes and CandyGuesses row and reports accurate counts", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    const result = await store.clearVotesAndCandyGuesses();
    expect(result).toEqual({ votesCleared: 2, guessesCleared: 1 });

    const votesUpdates = updateCalls.filter((c) => tabOf(c.range) === "Votes");
    const guessUpdates = updateCalls.filter((c) => tabOf(c.range) === "CandyGuesses");
    expect(votesUpdates).toHaveLength(2);
    expect(guessUpdates).toHaveLength(1);
    // Every write blanks the whole row, not just one field.
    for (const c of [...votesUpdates, ...guessUpdates]) {
      expect(c.requestBody!.values[0]!.every((cell) => cell === "")).toBe(true);
    }
  });

  it("never writes to Guests, Groups, Settings, or Passkeys", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await store.clearVotesAndCandyGuesses();

    const untouchedTabs = ["Guests", "Groups", "Settings", "Passkeys"];
    const touched = [...updateCalls, ...appendCalls].filter((c) => untouchedTabs.includes(tabOf(c.range)));
    expect(touched).toEqual([]);
  });
});

describe("getSessionsInvalidBefore / setSessionsInvalidBefore persistence", () => {
  // Unlike the two describe blocks above (static canned rows per tab), this
  // mock actually reads and writes a shared "Settings" backing array —
  // standing in for the real Google Sheet itself — so a write from one
  // GoogleSheetsDataStore instance is visible to a *completely separate*
  // later instance, proving the value lives in that backing store and not
  // in any in-memory variable scoped to the instance (or module) that
  // wrote it. `vi.resetModules()` mid-test clears the whole module graph
  // (including the 10s read cache) between the write and the read, the
  // same way a request landing on a different serverless instance would
  // never share either one.
  let settingsRows: string[][];

  beforeEach(() => {
    settingsRows = [];
    vi.resetModules();
    vi.doMock("@/lib/data-access/google-sheets/sheetsClient", () => ({
      getSheetsClient: vi.fn(async () => ({
        spreadsheets: {
          values: {
            get: vi.fn(async (req: { range: string }) => {
              if (tabOf(req.range) !== "Settings") return { data: { values: [] } };
              return { data: { values: settingsRows } };
            }),
            update: vi.fn(async (req: { range: string; requestBody: { values: string[][] } }) => {
              // "A{row}:B{row}" — row number is everything after the column letters.
              const rowNumber = Number.parseInt(req.range.replace(/^Settings!A/, ""), 10);
              settingsRows[rowNumber - 2] = req.requestBody.values[0]!;
              return {};
            }),
            append: vi.fn(async (req: { requestBody: { values: string[][] } }) => {
              settingsRows.push(...req.requestBody.values);
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

  it("a value written by one instance is read back by a completely separate later instance, not held in memory", async () => {
    const { GoogleSheetsDataStore: StoreA } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const writer = new StoreA();
    expect(await writer.getSessionsInvalidBefore()).toBeNull();

    const stamped = Date.UTC(2026, 9, 12, 20, 5, 0);
    await writer.setSessionsInvalidBefore(stamped);

    // Simulates an entirely new request on a different serverless instance:
    // fresh module graph, fresh DataStore instance, fresh (empty) read
    // cache — nothing carried over except the mocked "Sheet" itself.
    vi.resetModules();
    const { GoogleSheetsDataStore: StoreB } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const reader = new StoreB();
    expect(reader).not.toBe(writer);

    expect(await reader.getSessionsInvalidBefore()).toBe(stamped);
  });
});

describe("deleteNonAdminPasskeys", () => {
  it("blanks only the non-admin guests' Passkeys rows", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    const result = await store.deleteNonAdminPasskeys();
    expect(result.deleted).toBe(2);
    expect(result.guestIds.sort()).toEqual([GUEST1_ID, GUEST2_ID].sort());

    const passkeyUpdates = updateCalls.filter((c) => tabOf(c.range) === "Passkeys");
    expect(passkeyUpdates).toHaveLength(2);
    // Row 1 (A2:F2) is the admin's — never written.
    expect(passkeyUpdates.some((c) => c.range.startsWith("Passkeys!A2:"))).toBe(false);
  });

  it("never writes to Guests, Groups, Settings, Votes, or CandyGuesses", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await store.deleteNonAdminPasskeys();

    const untouchedTabs = ["Guests", "Groups", "Settings", "Votes", "CandyGuesses"];
    const touched = [...updateCalls, ...appendCalls].filter((c) => untouchedTabs.includes(tabOf(c.range)));
    expect(touched).toEqual([]);
  });
});

describe("resetToAdminsOnly", () => {
  it("reports accurate counts: non-admin guests deleted, admins kept, and everything in Votes/CandyGuesses/Passkeys cleared", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    const result = await store.resetToAdminsOnly();
    expect(result).toEqual({
      guestsDeleted: 2,
      adminsKept: 1,
      votesCleared: 2,
      guessesCleared: 1,
      passkeysCleared: 3,
      allGuestIds: [ADMIN_ID, GUEST1_ID, GUEST2_ID],
    });
  });

  it("deletes every non-admin Guests row but never writes to the admin's own Guests row at all", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await store.resetToAdminsOnly();

    const guestUpdates = updateCalls.filter((c) => tabOf(c.range) === "Guests");
    // GUEST_ROWS[0] (the admin) is sheet row 2 (row 1 is the header) —
    // confirm it's never the target of any write at all, not merely
    // written with identical content.
    expect(guestUpdates.some((c) => c.range.startsWith("Guests!A2:"))).toBe(false);
    // The two non-admin rows (sheet rows 3 and 4) are each blanked.
    expect(guestUpdates.some((c) => c.range.startsWith("Guests!A3:"))).toBe(true);
    expect(guestUpdates.some((c) => c.range.startsWith("Guests!A4:"))).toBe(true);
    for (const c of guestUpdates) {
      expect(c.requestBody!.values[0]!.every((cell) => cell === "")).toBe(true);
    }
    expect(appendCalls.filter((c) => tabOf(c.range) === "Guests")).toEqual([]);
  });

  it("blanks every Votes, CandyGuesses, and Passkeys row unconditionally, admin's own included, leaving none referencing any guestId", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await store.resetToAdminsOnly();

    const votesUpdates = updateCalls.filter((c) => tabOf(c.range) === "Votes");
    const guessUpdates = updateCalls.filter((c) => tabOf(c.range) === "CandyGuesses");
    const passkeyUpdates = updateCalls.filter((c) => tabOf(c.range) === "Passkeys");
    expect(votesUpdates).toHaveLength(VOTE_ROWS.length);
    expect(guessUpdates).toHaveLength(CANDY_GUESS_ROWS.length);
    expect(passkeyUpdates).toHaveLength(PASSKEY_ROWS.length);
    // Passkeys!A2 is the admin's own row — unlike deleteNonAdminPasskeys,
    // this reset has no admin exemption at all.
    expect(passkeyUpdates.some((c) => c.range.startsWith("Passkeys!A2:"))).toBe(true);
    for (const c of [...votesUpdates, ...guessUpdates, ...passkeyUpdates]) {
      expect(c.requestBody!.values[0]!.every((cell) => cell === "")).toBe(true);
    }
  });

  it("never writes to Groups or Settings", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await store.resetToAdminsOnly();

    const untouchedTabs = ["Groups", "Settings"];
    const touched = [...updateCalls, ...appendCalls].filter((c) => untouchedTabs.includes(tabOf(c.range)));
    expect(touched).toEqual([]);
  });
});
