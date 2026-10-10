/**
 * Covers the short-lived read cache (sheetReadCache.ts) wired into
 * SheetTable.getAllRows(): cache hits within the TTL, expiry, invalidation
 * on write, in-flight de-duplication, `fresh` bypassing the cache
 * entirely, and errors never being cached. Driven through a real
 * SheetTable with only the Sheets API client mocked, same approach as
 * sheetsInjection.test.ts's "SheetTable" suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeRow = { id: string; name: string };

let getCalls: Array<{ spreadsheetId: string; range: string }>;
let getImpl: (req: { spreadsheetId: string; range: string }) => Promise<{ data: { values: string[][] } }>;

beforeEach(() => {
  getCalls = [];
  getImpl = async () => ({ data: { values: [["row-1", "Alice"]] } });
  vi.resetModules();
  vi.doMock("@/lib/data-access/google-sheets/sheetsClient", () => ({
    getSheetsClient: vi.fn(async () => ({
      spreadsheets: {
        values: {
          get: vi.fn(async (req: { spreadsheetId: string; range: string }) => {
            getCalls.push(req);
            return getImpl(req);
          }),
          update: vi.fn(async () => ({})),
          append: vi.fn(async () => ({})),
        },
      },
    })),
    getSpreadsheetId: vi.fn(() => "fake-spreadsheet-id"),
  }));
});

afterEach(() => {
  vi.doUnmock("@/lib/data-access/google-sheets/sheetsClient");
  vi.resetModules();
  vi.useRealTimers();
});

async function makeTable() {
  const { SheetTable } = await import("@/lib/data-access/google-sheets/SheetTable");
  return new SheetTable<FakeRow>("Guests", ["id", "name"]);
}

describe("SheetTable read cache", () => {
  it("serves a second read within the TTL from the cache, with no new API call", async () => {
    const table = await makeTable();

    const first = await table.getAllRows();
    const second = await table.getAllRows();

    expect(getCalls).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it("makes a fresh API call once the TTL has elapsed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T12:00:00.000Z"));
    const table = await makeTable();

    await table.getAllRows();
    expect(getCalls).toHaveLength(1);

    // Just under the 10s TTL: still cached.
    vi.setSystemTime(new Date("2026-10-09T12:00:09.000Z"));
    await table.getAllRows();
    expect(getCalls).toHaveLength(1);

    // Past the 10s TTL: cache entry has expired.
    vi.setSystemTime(new Date("2026-10-09T12:00:10.001Z"));
    await table.getAllRows();
    expect(getCalls).toHaveLength(2);
  });

  it("invalidates the cache entry immediately after a write (updateRow)", async () => {
    const table = await makeTable();

    await table.getAllRows();
    expect(getCalls).toHaveLength(1);

    await table.updateRow(2, { id: "row-1", name: "Alice Updated" });

    await table.getAllRows();
    expect(getCalls).toHaveLength(2);
  });

  it("invalidates the cache entry immediately after a write (appendRow)", async () => {
    const table = await makeTable();

    await table.getAllRows();
    expect(getCalls).toHaveLength(1);

    await table.appendRow({ id: "row-2", name: "Bob" });

    await table.getAllRows();
    expect(getCalls).toHaveLength(2);
  });

  it("de-duplicates concurrent in-flight reads into a single API call", async () => {
    let resolveGet!: (res: { data: { values: string[][] } }) => void;
    getImpl = () =>
      new Promise((resolve) => {
        resolveGet = resolve;
      });
    const table = await makeTable();

    const callA = table.getAllRows();
    const callB = table.getAllRows();

    // Let both calls reach (and share) the in-flight Sheets API call before resolving it.
    await Promise.resolve();
    await Promise.resolve();
    resolveGet({ data: { values: [["row-1", "Alice"]] } });
    const [resultA, resultB] = await Promise.all([callA, callB]);

    expect(getCalls).toHaveLength(1);
    expect(resultA).toEqual(resultB);
  });

  it("a fresh read bypasses the cache and does not populate it either", async () => {
    const table = await makeTable();

    await table.getAllRows(); // populates the cache
    expect(getCalls).toHaveLength(1);

    await table.getAllRows({ fresh: true }); // bypasses it
    expect(getCalls).toHaveLength(2);

    // The fresh read didn't touch the cache — the still-valid original
    // cache entry (from the very first call) is what serves this one.
    await table.getAllRows();
    expect(getCalls).toHaveLength(2);
  });

  it("never caches a failed read — the next read retries against the API", async () => {
    let shouldFail = true;
    getImpl = async () => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("Sheets API unavailable");
      }
      return { data: { values: [["row-1", "Alice"]] } };
    };
    const table = await makeTable();

    await expect(table.getAllRows()).rejects.toThrow("Sheets API unavailable");
    expect(getCalls).toHaveLength(1);

    const rows = await table.getAllRows();
    expect(getCalls).toHaveLength(2);
    expect(rows[0]!.values).toEqual({ id: "row-1", name: "Alice" });
  });

  it("does not share a failed in-flight read with a concurrent caller", async () => {
    let rejectGet!: (err: Error) => void;
    getImpl = () =>
      new Promise((_, reject) => {
        rejectGet = reject;
      });
    const table = await makeTable();

    const callA = table.getAllRows();
    const callB = table.getAllRows();

    // Let both calls reach (and share) the in-flight Sheets API call before rejecting it.
    await Promise.resolve();
    await Promise.resolve();
    rejectGet(new Error("boom"));

    await expect(callA).rejects.toThrow("boom");
    await expect(callB).rejects.toThrow("boom");

    // Cleaned up after the failure — the next read tries the API again.
    getImpl = async () => ({ data: { values: [["row-1", "Alice"]] } });
    await table.getAllRows();
    expect(getCalls).toHaveLength(2);
  });
});
