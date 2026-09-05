import type { CsvMapper } from "../types";
import { eviteMapper } from "./eviteMapper";

/**
 * Registry of supported CSV source formats. Add a new mapper here (and its
 * own file alongside eviteMapper.ts) to support e.g. a future invitation
 * tool's export — the parsing, detection, and confirm-UI flow in
 * ../importGuests.ts is generic and doesn't need to change.
 */
export const csvMappers: CsvMapper[] = [eviteMapper];

export function getMapperById(id: string): CsvMapper | undefined {
  return csvMappers.find((m) => m.id === id);
}

export function detectMapper(headers: string[]): CsvMapper | undefined {
  return csvMappers.find((m) => m.detect(headers));
}
