import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

// Bounds how much work the mapper (and, for Evite, its per-row "additional
// guests" splitting) can be made to do by a file that's well under the
// upload byte cap but pathologically wide or tall — e.g. a 2MB file of
// one-byte rows, or a single row with thousands of columns. Both are far
// beyond any real guest-list export.
const MAX_ROWS = 5000;
const MAX_COLUMNS = 50;

/**
 * Generic CSV -> header-keyed row parsing, independent of any source
 * format. Papa.parse is only ever given this literal file-content string
 * to tokenize — no `download` option (which would treat it as a URL to
 * fetch instead) is set, so nothing here ever makes a network request.
 */
export function parseCsvToRows(fileContent: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(fileContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    const first = result.errors[0];
    throw new Error(`Failed to parse CSV: ${first?.message ?? "unknown error"}`);
  }

  const headers = result.meta.fields ?? [];
  if (headers.length > MAX_COLUMNS) {
    throw new Error(`This file has too many columns (max ${MAX_COLUMNS}).`);
  }
  if (result.data.length > MAX_ROWS) {
    throw new Error(`This file has too many rows (max ${MAX_ROWS}).`);
  }

  return { headers, rows: result.data };
}
