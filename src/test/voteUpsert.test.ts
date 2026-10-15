/**
 * One vote per (voter, category), even under concurrent submissions: the
 * real GoogleSheetsDataStore against an in-memory, *stateful* fake of the
 * Sheets API (reads see earlier writes), with network latency simulated so
 * concurrent calls genuinely interleave their read-then-write.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Grid = string[][]; // row 0 = sheet row 2

let votesTab: Grid;

function rowIndexOf(range: string): number {
  const m = /!A(\d+):/.exec(range);
  return Number(m![1]) - 2;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  votesTab = [];
  vi.resetModules();
  vi.doMock("@/lib/data-access/google-sheets/sheetsClient", () => ({
    getSheetsClient: vi.fn(async () => ({
      spreadsheets: {
        values: {
          get: vi.fn(async (req: { range: string }) => {
            await tick();
            return { data: { values: req.range.startsWith("Votes!") ? votesTab.map((r) => [...r]) : [] } };
          }),
          append: vi.fn(async (req: { range: string; requestBody: { values: Grid } }) => {
            await tick();
            if (req.range.startsWith("Votes!")) votesTab.push(...req.requestBody.values);
            return {};
          }),
          update: vi.fn(async (req: { range: string; requestBody: { values: Grid } }) => {
            await tick();
            if (req.range.startsWith("Votes!")) votesTab[rowIndexOf(req.range)] = req.requestBody.values[0]!;
            return {};
          }),
          batchUpdate: vi.fn(async (req: { requestBody: { data: { range: string; values: Grid }[] } }) => {
            await tick();
            for (const d of req.requestBody.data) {
              if (d.range.startsWith("Votes!")) votesTab[rowIndexOf(d.range)] = d.values[0]!;
            }
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

const VOTER = "00000000-0000-0000-0000-00000000e001";

function liveRows() {
  return votesTab.filter((r) => r.some((c) => c !== ""));
}

describe("recordVote is an upsert on (voter, category)", () => {
  it("ten simultaneous submissions for the same voter and category leave exactly one row, holding one of the submitted picks", async () => {
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.recordVote({ voterGuestId: VOTER, category: "best-costume", nomineeId: `nominee-${i}` }),
      ),
    );

    const rows = liveRows().filter((r) => r[0] === VOTER && r[1] === "best-costume");
    expect(rows).toHaveLength(1);
    expect(rows[0]![2]).toMatch(/^nominee-\d$/);
    expect(await store.getVotes({ fresh: true })).toHaveLength(1);
  });

  it("repairs duplicate rows that already exist (e.g. from another server instance): the next vote overwrites one and blanks the rest", async () => {
    votesTab = [
      [VOTER, "best-costume", "a", "2026-10-31T20:00:00.000Z"],
      [VOTER, "best-costume", "b", "2026-10-31T20:00:01.000Z"],
      [VOTER, "scariest", "c", "2026-10-31T20:00:02.000Z"],
    ];
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();

    await store.recordVote({ voterGuestId: VOTER, category: "best-costume", nomineeId: "z" });

    const bestCostume = liveRows().filter((r) => r[1] === "best-costume");
    expect(bestCostume).toHaveLength(1);
    expect(bestCostume[0]![2]).toBe("z");
    expect(liveRows().filter((r) => r[1] === "scariest")).toHaveLength(1);
  });

  it("getVotes never returns more than one vote per (voter, category), even before a repair — the latest wins", async () => {
    votesTab = [
      [VOTER, "best-costume", "a", "2026-10-31T20:00:00.000Z"],
      [VOTER, "best-costume", "b", "2026-10-31T20:00:05.000Z"],
      [VOTER, "best-costume", "c", "2026-10-31T20:00:01.000Z"],
    ];
    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const votes = await new GoogleSheetsDataStore().getVotes({ fresh: true });
    expect(votes).toEqual([
      { voterGuestId: VOTER, category: "best-costume", nomineeId: "b", timestamp: "2026-10-31T20:00:05.000Z" },
    ]);
  });
});

describe("lastSelectionPerCategory", () => {
  it("collapses a ballot that names the same category twice to the final pick", async () => {
    const { lastSelectionPerCategory } = await import("@/lib/voteSelections");
    expect(
      lastSelectionPerCategory([
        { category: "a", nomineeId: "1" },
        { category: "b", nomineeId: "2" },
        { category: "a", nomineeId: "3" },
      ]),
    ).toEqual([
      { category: "b", nomineeId: "2" },
      { category: "a", nomineeId: "3" },
    ]);
  });
});
