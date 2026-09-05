import "server-only";
import { getSheetsClient, getSpreadsheetId } from "./sheetsClient";

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

  /** Returns every non-blank data row along with its 1-based sheet row number. */
  async getAllRows(): Promise<Array<{ rowNumber: number; values: T }>> {
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
  }
}
