import Papa from "papaparse";

// Bounds how much work validation can be made to do by a file that's well
// under the upload byte cap but pathologically wide or tall — e.g. a 2MB
// file of one-byte rows, or a single row with thousands of columns. Both
// are far beyond any real guest list.
const MAX_ROWS = 5000;
const MAX_COLUMNS = 50;

/**
 * Generic CSV -> positional rows (arrays of cell strings), independent of
 * what the columns mean. Papa.parse is only ever given this literal
 * file-content string to tokenize — no `download` option (which would
 * treat it as a URL to fetch instead) is set, so nothing here ever makes a
 * network request.
 */
export function parseCsvToRows(fileContent: string): string[][] {
  const result = Papa.parse<string[]>(fileContent, {
    header: false,
    skipEmptyLines: "greedy",
  });

  // UndetectableDelimiter is only a warning (Papa falls back to a comma),
  // reported for any file whose rows have a single column — those rows are
  // still parsed fine, and the row validator reports the missing fields.
  const fatal = result.errors.filter((e) => e.code !== "UndetectableDelimiter");
  if (fatal.length > 0) {
    const first = fatal[0];
    const row = first?.row !== undefined ? ` (row ${first.row + 1})` : "";
    throw new Error(`Failed to parse CSV${row}: ${first?.message ?? "unknown error"}`);
  }

  if (result.data.some((row) => row.length > MAX_COLUMNS)) {
    throw new Error(`This file has too many columns (max ${MAX_COLUMNS}).`);
  }
  // +1 so an optional header row doesn't count against the guest-row limit.
  if (result.data.length > MAX_ROWS + 1) {
    throw new Error(`This file has too many rows (max ${MAX_ROWS}).`);
  }

  return result.data;
}
