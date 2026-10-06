/**
 * Marks an error's message as deliberately written to be shown to the
 * caller as-is — a business-rule failure like "Guest not found" or
 * "Guest is already in a group," never a detail about how or where
 * something is stored. Thrown from GoogleSheetsDataStore.ts for exactly
 * that category of failure, and from the local ceremony helpers in
 * POST /api/auth/passkey/finish for the same reason.
 *
 * Everything else that can escape a DataStore call or auth helper — a raw
 * Google Sheets API failure (which can include the sheet's range or tab
 * name in its own message), a WebAuthn library error, a network error —
 * is some other Error (or non-Error) value. Route handlers check
 * `instanceof PublicError` before forwarding a caught error's message;
 * anything else must be logged server-side and replaced with a generic
 * message, never passed through.
 */
export class PublicError extends Error {}
