/**
 * Shared request-input validators for the API routes, run at the boundary
 * before any user-supplied value reaches the DataStore — none of this
 * talks to Sheets. Nothing in this app currently builds a Sheets range,
 * tab name, or formula out of request data (ranges are always a fixed tab
 * name + a header-derived column letter + an integer row position the
 * DataStore computes itself — see SheetTable.ts), so these checks aren't
 * closing a working injection path; they're the strict allowlist/pattern
 * layer the data-access-layer audit calls for, rejecting malformed input
 * at the API boundary with a clear 400 instead of letting it reach a
 * lookup that would otherwise just (safely) report "not found."
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a well-formed UUID — the exact shape every guest and group id
 * in this app is generated as (`uuidv4()` in GoogleSheetsDataStore.ts).
 * Anything else — empty, too long, containing punctuation like `!` or
 * `:`, or literal range-shaped text such as "Sheet1!A1:Z999" — is
 * rejected outright rather than ever reaching a DataStore lookup.
 */
export function isValidId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Max length for a single free-text field like a guest or group name — generous for any real name, small enough to keep a crafted payload from bloating the Sheet. */
export const MAX_SHORT_TEXT_LENGTH = 100;

/**
 * A plausible short piece of free text — a guest's first/last name, a
 * group's name. Deliberately permissive on characters: apostrophes,
 * hyphens, accents, even punctuation are all normal in real names, and
 * none of it is ever used to address a Sheets range or cell — only type
 * and length are enforced here. Content-level formula-injection
 * protection for the literal characters this value starts with is a
 * separate, write-time concern (see sanitizeForSheets.ts).
 */
export function isValidShortText(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SHORT_TEXT_LENGTH;
}
