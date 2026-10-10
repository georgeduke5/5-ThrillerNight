import "server-only";
import { getSheetsClient, getSpreadsheetId } from "./sheetsClient";
import { invalidate, readThrough, type ReadCacheOptions } from "./sheetReadCache";

/**
 * Thin, generic wrapper around one tab of the spreadsheet, treating row 1 as
 * a header row and every row after it as a plain object keyed by `headers`.
 * This is the only place that talks to the Sheets API directly; everything
 * above it (GoogleSheetsDataStore) works with typed row objects.
 */
export class SheetTable<T extends Record<string, string>> {
  constructor(
    private readonly tabName: string,
    private readonly headers: ReadonlyArray<keyof T & string>,
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

  async updateRow(rowNumber: number, obj: T): Promise<void> {
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
}
