import type { GuestBracket } from "@/lib/config/types";
import { isPlausiblePhone } from "@/lib/auth/phoneFormat";
import { isValidShortText } from "@/lib/validation";
import type { ImportedGuest, ImportRowError } from "./types";
import { parseCsvToRows } from "./parseCsv";

/**
 * The import CSV's columns, in order. The file may optionally start with a
 * header row naming them (detected by its first cell reading "First Name");
 * every other row is a guest.
 */
export const IMPORT_COLUMNS = ["First Name", "Last Name", "Category", "Phone Number"] as const;

/** The exact Category values the CSV may use, mapped to their bracket. Matched case-insensitively. */
export const CATEGORY_TO_BRACKET: Record<string, GuestBracket> = {
  "adult male": "adult-male",
  "adult female": "adult-female",
  boy: "boy",
  girl: "girl",
};

export const CATEGORY_LABELS = ["Adult Male", "Adult Female", "Boy", "Girl"] as const;

export function categoryToBracket(value: string): GuestBracket | null {
  return CATEGORY_TO_BRACKET[value.trim().replace(/\s+/g, " ").toLowerCase()] ?? null;
}

export interface ParsedImport {
  guests: ImportedGuest[];
  /** Every invalid row in the file — when non-empty, nothing should be imported. */
  errors: ImportRowError[];
}

function isHeaderRow(cells: string[]): boolean {
  return cells[0]?.trim().toLowerCase() === "first name";
}

/**
 * Validates one row's cells (already split from the CSV) into a guest, or
 * returns every problem with it. Shared by the CSV upload and the confirm
 * step, which re-checks whatever the client sends back.
 */
export function validateGuestFields(fields: {
  firstName: string;
  lastName: string;
  category: string;
  phone: string;
}): { guest: ImportedGuest } | { problems: string[] } {
  const firstName = fields.firstName.trim();
  const lastName = fields.lastName.trim();
  const category = fields.category.trim();
  const phone = fields.phone.trim();
  const problems: string[] = [];

  const missing = [
    !firstName && "First Name",
    !lastName && "Last Name",
    !category && "Category",
    !phone && "Phone Number",
  ].filter(Boolean);
  if (missing.length > 0) problems.push(`missing ${missing.join(", ")}`);

  if (firstName && !isValidShortText(firstName)) problems.push("First Name is too long");
  if (lastName && !isValidShortText(lastName)) problems.push("Last Name is too long");

  const bracket = category ? categoryToBracket(category) : null;
  if (category && !bracket) {
    problems.push(`invalid Category "${category}" (must be one of: ${CATEGORY_LABELS.join(", ")})`);
  }

  if (phone && !isPlausiblePhone(phone)) problems.push(`invalid Phone Number "${phone}"`);

  if (problems.length > 0 || !bracket) return { problems };
  return { guest: { firstName, lastName, bracket, phone } };
}

/**
 * Stage one of CSV import: parse and validate the file. This never touches
 * the data access layer — nothing is written until the admin confirms and
 * the app calls DataStore.addGuests() (see /api/import/confirm).
 */
export function parseCsvForImport(fileContent: string): ParsedImport {
  const rows = parseCsvToRows(fileContent);
  const guests: ImportedGuest[] = [];
  const errors: ImportRowError[] = [];

  rows.forEach((cells, index) => {
    const row = index + 1;
    if (index === 0 && isHeaderRow(cells)) return;

    if (cells.length > IMPORT_COLUMNS.length && cells.slice(IMPORT_COLUMNS.length).some((c) => c.trim())) {
      errors.push({
        row,
        message: `expected ${IMPORT_COLUMNS.length} columns (${IMPORT_COLUMNS.join(", ")}) but found ${cells.length}`,
      });
      return;
    }

    const [firstName = "", lastName = "", category = "", phone = ""] = cells;
    const result = validateGuestFields({ firstName, lastName, category, phone });
    if ("problems" in result) {
      errors.push({ row, message: result.problems.join("; ") });
    } else {
      guests.push(result.guest);
    }
  });

  return { guests, errors };
}
