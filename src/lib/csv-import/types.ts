import type { GuestBracket } from "@/lib/config/types";

/**
 * A guest candidate produced by parsing + mapping a CSV file. bracket is
 * intentionally nullable: source formats like Evite's export don't carry an
 * Adult Male/Adult Female/Boy/Girl designation, so the admin UI must collect
 * it before the candidate can become a real guest record.
 */
export interface MappedGuestCandidate {
  firstName: string;
  lastName: string;
  bracket: GuestBracket | null;
  /** Original row data, kept only for the admin's review UI. */
  raw: Record<string, string>;
}

/**
 * One source-format mapper (e.g. Evite). New import sources are added by
 * writing a new CsvMapper and registering it in ./mappers/index.ts — the
 * rest of the import flow (parsing, the confirm UI, writing through the
 * data access layer) never changes.
 */
export interface CsvMapper {
  id: string;
  label: string;
  /** Best-effort sniff of whether this mapper understands the given header row. */
  detect(headers: string[]): boolean;
  map(rows: Record<string, string>[]): MappedGuestCandidate[];
}
