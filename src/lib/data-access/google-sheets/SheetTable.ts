import "server-only";
import { getSheetsClient, getSpreadsheetId } from "./sheetsClient";
import { invalidate, readThrough, type ReadCacheOptions } from "./sheetReadCache";

/**
 * Thin, generic wrapper around one tab of the spreadsheet, treating row 1 as
 * a header row and every row after it as a plain object keyed by `headers`.
 * This is the only place that talks to the Sheets API directly; everything
 * above it (GoogleSheetsDataStore) works with typed row objects.
 */
export interface SheetTableOptions {
  /**
   * Runs before every append/update through this table and may throw to
   * block it — how GoogleSheetsDataStore holds off ordinary writes while
   * "Reset to admins only" is running. batchWriteAcrossTabs skips it.
   */
  beforeWrite?: () => Promise<void>;
}

export class SheetTable<T extends Record<string, string>> {
  constructor(
    private readonly tabName: string,
    private readonly headers: ReadonlyArray<keyof T & string>,
    private readonly options: SheetTableOptions = {},
  ) {}

  private range(a1: string): string {
    return `${this.tabName}!${a1}`;
  }

  private lastColumnLetter(): string {
    // Header lists here are small (well under 26 columns), so a single
    // letter is sufficient.
    return String.fromCharCode("A".charCodeAt(0) + this.headers.length - 1);
  }

  private rowToObject(row: string[]): T {
    const obj = {} as Record<string, string>;
    this.headers.forEach((header, i) => {
      obj[header] = row[i] ?? "";
    });
    return obj as T;
  }

  private objectToRow(obj: T): string[] {
    return this.headers.map((header) => obj[header] ?? "");
  }

  /**
   * Returns every non-blank data row along with its 1-based sheet row
   * number. Cached for a short TTL, keyed by this table's tab name — see
   * sheetReadCache.ts. Pass `{ fresh: true }` for any read that gates a
   * write (a duplicate check, a read-then-update flow); every other read
   * can use the default cached path.
   */
  async getAllRows(options: ReadCacheOptions = {}): Promise<Array<{ rowNumber: number; values: T }>> {
    return readThrough(this.tabName, options, async () => {
      const sheets = await getSheetsClient();
      const spreadsheetId = getSpreadsheetId();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: this.range(`A2:${this.lastColumnLetter()}`),
      });
      const rows = res.data.values ?? [];
      return rows
        .map((row, idx) => ({ rowNumber: idx + 2, values: this.rowToObject(row) }))
        .filter((r) => Object.values(r.values).some((v) => v !== ""));
    });
  }

  async appendRow(obj: T): Promise<void> {
    await this.appendRows([obj]);
  }

  async appendRows(objs: T[]): Promise<void> {
    if (objs.length === 0) return;
    await this.options.beforeWrite?.();
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: this.range("A1"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: objs.map((o) => this.objectToRow(o)) },
    });
    invalidate(this.tabName);
  }

  /** Several row updates in one Sheets API call (values.batchUpdate) — same per-row semantics as updateRow. */
  async updateRows(updates: Array<{ rowNumber: number; values: T }>): Promise<void> {
    if (updates.length === 0) return;
    await this.options.beforeWrite?.();
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: updates.map((u) => ({
          range: this.range(`A${u.rowNumber}:${this.lastColumnLetter()}${u.rowNumber}`),
          values: [this.objectToRow(u.values)],
        })),
      },
    });
    invalidate(this.tabName);
  }

  async updateRow(rowNumber: number, obj: T): Promise<void> {
    await this.options.beforeWrite?.();
    const sheets = await getSheetsClient();
    const spreadsheetId = getSpreadsheetId();
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: this.range(`A${rowNumber}:${this.lastColumnLetter()}${rowNumber}`),
      valueInputOption: "RAW",
      requestBody: { values: [this.objectToRow(obj)] },
    });
    invalidate(this.tabName);
  }

  /** One row write in the shape values.batchUpdate takes — see batchWriteAcrossTabs. */
  rowWrite(rowNumber: number, obj: T): { tabName: string; range: string; values: string[][] } {
    return {
      tabName: this.tabName,
      range: this.range(`A${rowNumber}:${this.lastColumnLetter()}${rowNumber}`),
      values: [this.objectToRow(obj)],
    };
  }
}

/**
 * Row writes across several tabs in ONE values.batchUpdate call: a single
 * write request against the Sheets per-minute quota however many rows it
 * touches, and applied by Sheets as one request rather than many that can
 * fail independently. Deliberately skips every table's beforeWrite guard —
 * it exists for the reset that guard protects.
 */
export async function batchWriteAcrossTabs(
  writes: Array<{ tabName: string; range: string; values: string[][] }>,
): Promise<void> {
  if (writes.length === 0) return;
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: writes.map((w) => ({ range: w.range, values: w.values })),
    },
  });
  for (const tab of new Set(writes.map((w) => w.tabName))) invalidate(tab);
}
