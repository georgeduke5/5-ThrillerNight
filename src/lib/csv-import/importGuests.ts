import type { GuestBracket } from "@/lib/config/types";
import { toSmsPhone } from "@/lib/auth/phoneFormat";
import { isValidShortText } from "@/lib/validation";
import type { ImportedGuest, ImportRowError, ImportRowWarning } from "./types";
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
  /** Rows that are imported anyway but worth a look: a missing name, or no usable phone number. */
  warnings: ImportRowWarning[];
}

function isHeaderRow(cells: string[]): boolean {
  return cells[0]?.trim().toLowerCase() === "first name";
}

/**
 * Validates one row's cells (already split from the CSV) into a guest, or
 * returns every problem with it. Shared by the CSV upload and the confirm
 * step, which re-checks whatever the client sends back.
 *
 * Only a missing or unknown Category (needed to put the guest on the right
 * ballot), a row with no name at all, or an over-long name blocks a row.
 * A missing first or last name, and a phone that isn't a real 10-digit
 * number (blank, a placeholder like "no phone" or "n/a", or malformed),
 * are warnings: the guest is imported, with no phone stored in the latter
 * case — the same rule (toSmsPhone) the SMS check uses.
 */
export function validateGuestFields(fields: {
  firstName: string;
  lastName: string;
  category: string;
  phone: string;
}): { guest: ImportedGuest; warnings: string[] } | { problems: string[] } {
  const firstName = fields.firstName.trim();
  const lastName = fields.lastName.trim();
  const category = fields.category.trim();
  const phone = fields.phone.trim();
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!firstName && !lastName) problems.push("missing First Name and Last Name (a guest needs at least one)");
  if (!category) problems.push("missing Category");

  if (firstName && !isValidShortText(firstName)) problems.push("First Name is too long");
  if (lastName && !isValidShortText(lastName)) problems.push("Last Name is too long");

  const bracket = category ? categoryToBracket(category) : null;
  if (category && !bracket) {
    problems.push(`invalid Category "${category}" (must be one of: ${CATEGORY_LABELS.join(", ")})`);
  }

  if (problems.length > 0 || !bracket) return { problems };

  if (!firstName) warnings.push("missing First Name");
  if (!lastName) warnings.push("missing Last Name");

  const hasSmsPhone = toSmsPhone(phone) !== null;
  if (!hasSmsPhone) {
    // No digits at all (blank, "no phone", "n/a", "none"…) reads as an
    // explicit "no phone"; anything else is a number that doesn't work.
    warnings.push(
      /\d/.test(phone)
        ? `Phone Number "${phone}" isn't a valid 10-digit number, so this guest has no phone on file`
        : "no phone on file",
    );
  }

  return { guest: { firstName, lastName, bracket, phone: hasSmsPhone ? phone : null }, warnings };
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
  const warnings: ImportRowWarning[] = [];

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
      if (result.warnings.length > 0) warnings.push({ row, message: result.warnings.join("; ") });
    }
  });

  return { guests, errors, warnings };
}
