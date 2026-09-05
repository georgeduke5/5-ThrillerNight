import type { MappedGuestCandidate } from "./types";
import { parseCsvToRows } from "./parseCsv";
import { detectMapper, getMapperById } from "./mappers";

export interface ParsedImport {
  mapperId: string;
  mapperLabel: string;
  candidates: MappedGuestCandidate[];
}

/**
 * Stage one of CSV import: parse the file and map it to guest candidates
 * for the admin to review. This never touches the data access layer —
 * nothing is written until the admin confirms a bracket for each
 * candidate and the app calls DataStore.addGuests() (see
 * /api/import/confirm).
 */
export function parseCsvForImport(fileContent: string, mapperId?: string): ParsedImport {
  const { headers, rows } = parseCsvToRows(fileContent);

  const mapper = mapperId ? getMapperById(mapperId) : detectMapper(headers);
  if (!mapper) {
    throw new Error(
      "Couldn't detect a matching CSV format for this file's columns. Supported formats: " +
        "Evite export.",
    );
  }

  const candidates = mapper.map(rows);
  return { mapperId: mapper.id, mapperLabel: mapper.label, candidates };
}
