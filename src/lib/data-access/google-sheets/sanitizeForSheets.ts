/**
 * Guards against CSV/formula injection (CWE-1236) for every piece of
 * user-supplied text this app writes to Google Sheets. The googleapis
 * Node.js client never does this on its own — it writes whatever string
 * it's given as-is — so every write path that touches guest-entered or
 * admin-entered free text must funnel through sanitizeForSheets before it
 * reaches the Sheets API. See SheetTable.ts, which writes with
 * `valueInputOption: "RAW"`: Sheets itself never evaluates a RAW-written
 * cell as a formula (confirmed empirically against this project's own
 * spreadsheet — a RAW-written "=1+1" is stored as the literal text "=1+1",
 * not computed), so the actual risk this closes is downstream: an admin
 * exporting the guest list to CSV and opening it in Excel (an entirely
 * ordinary workflow) evaluates a cell starting with =, +, -, or @ as a live
 * formula the moment the file is opened — the classic CWE-1236 payloads
 * (e.g. `=cmd|' /C calc'!A0`) run at that point, planted via nothing more
 * than a guest's own name. Tab and carriage-return characters are included
 * too, since a leading whitespace-like control character has historically
 * been used to smuggle a trigger character past checks that only look at
 * position 0 after trimming.
 *
 * Prefixing with a single quote is the universal plain-text escape every
 * spreadsheet application (Excel, Sheets, LibreOffice) honors on open/
 * import: a leading apostrophe means "this cell is literal text," no
 * matter what follows it.
 */
export const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@", "\t", "\r"];

export function sanitizeForSheets(value: string): string {
  return FORMULA_TRIGGER_CHARS.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;
}

/**
 * The read-side counterpart. Typing a leading apostrophe into the Sheets UI
 * (or writing with `valueInputOption: "USER_ENTERED"`) makes Sheets store
 * it as a display-only text-format hint and strip it from the value an API
 * read returns — but this app writes with RAW, which stores exactly what
 * it's given with no such parsing. Confirmed empirically: a RAW-written
 * "'=1+1" comes back from values.get() as the literal string "'=1+1",
 * apostrophe included, under every valueRenderOption. Left unhandled, every
 * guest whose name or phone number happens to start with a trigger
 * character (an E.164 phone number starting with "+" is a completely
 * ordinary example) would show a permanent, incorrect leading quote mark
 * everywhere their data is read back.
 *
 * Only strips the apostrophe when it's immediately followed by one of the
 * same trigger characters — the exact shape sanitizeForSheets itself
 * produces. A value that happens to start with a literal apostrophe
 * followed by anything else (e.g. a name using an ʻokina) was never touched
 * by sanitizeForSheets in the first place, so this can never misfire on a
 * guest's real data.
 */
export function desanitizeFromSheets(value: string): string {
  if (value.startsWith("'") && FORMULA_TRIGGER_CHARS.some((prefix) => value.startsWith(prefix, 1))) {
    return value.slice(1);
  }
  return value;
}
