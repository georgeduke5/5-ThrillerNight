import Papa from "papaparse";

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Generic CSV -> header-keyed row parsing, independent of any source format. */
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

  return { headers: result.meta.fields ?? [], rows: result.data };
}
