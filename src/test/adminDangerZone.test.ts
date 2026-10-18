/**
 * Drives the REAL GoogleSheetsDataStore (only the Sheets API client itself
 * is mocked, same approach as sheetsInjection.test.ts's "SheetTable" suite)
 * for the /admin/security Danger Zone operations, proving the actual
 * row-selection logic — not just that a route calls the right method name:
 *
 * - clearVotesAndCandyGuesses blanks every Votes and CandyGuesses row and
 *   nothing else (Guests, Groups, Settings, Passkeys all untouched).
 * - deleteNonAdminPasskeys blanks only the Passkeys rows belonging to a
 *   non-admin guest, leaving an admin's passkey row alone.
 *
 * resetToAdminsOnly has its own stateful suite in resetToAdminsOnly.test.ts.
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
  row(GUEST_HEADERS, { id: GUEST1_ID, firstName: "Gus", lastName: "Est", isAdmin: "", checkedInAt: "2026-10-31T19:00:00.000Z" }),
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
          // SheetTable.updateRows — recorded as one updateCalls entry per row
          // so assertions don't care whether rows were written singly or batched.
          batchUpdate: vi.fn(
            async (req: { spreadsheetId: string; requestBody: { data: { range: string; values: string[][] }[] } }) => {
              for (const d of req.requestBody.data) {
                updateCalls.push({ spreadsheetId: req.spreadsheetId, range: d.range, requestBody: { values: d.values } });
              }
              return {};
            },
          ),
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

  it("in the same step, resets every affected guest to pending (even one already checked in) before deleting their passkey", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await store.deleteNonAdminPasskeys();

    const guestUpdates = updateCalls.filter((c) => tabOf(c.range) === "Guests");
    // Admin is sheet row 2 — never touched; GUEST1 (row 3) and GUEST2 (row 4) flipped.
    expect(guestUpdates.map((c) => c.range.split("!")[1]!.split(":")[0]).sort()).toEqual(["A3", "A4"]);
    const checkedInAt = GUEST_HEADERS.indexOf("checkedInAt");
    const pendingApprovalAt = GUEST_HEADERS.indexOf("pendingApprovalAt");
    for (const c of guestUpdates) {
      expect(c.requestBody!.values[0]![checkedInAt]).toBe("");
      expect(c.requestBody!.values[0]![pendingApprovalAt]).not.toBe("");
    }
    // Status before credential: the first Passkeys write comes after every Guests write.
    const firstPasskeyWrite = updateCalls.findIndex((c) => tabOf(c.range) === "Passkeys");
    const lastGuestWrite = updateCalls.map((c) => tabOf(c.range)).lastIndexOf("Guests");
    expect(lastGuestWrite).toBeLessThan(firstPasskeyWrite);
  });

  it("never writes to Groups, Settings, Votes, or CandyGuesses", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await store.deleteNonAdminPasskeys();

    const untouchedTabs = ["Groups", "Settings", "Votes", "CandyGuesses"];
    const touched = [...updateCalls, ...appendCalls].filter((c) => untouchedTabs.includes(tabOf(c.range)));
    expect(touched).toEqual([]);
  });
});
