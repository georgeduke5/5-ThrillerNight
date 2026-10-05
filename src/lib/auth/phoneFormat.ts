/**
 * Pure phone-number formatting/validation helpers, shared by every flow
 * that accepts a phone number directly from a guest or admin and by
 * twilioVerify.ts (which actually calls the Twilio API with the result).
 * Deliberately has no "server-only" import and no env/secret access of its
 * own, unlike twilioVerify.ts — so it can be unit-tested directly under
 * Vitest's plain Node environment, which "server-only" throws under (it
 * resolves to a module that unconditionally throws, meant to catch a
 * server-only module accidentally reaching a client bundle).
 */

/**
 * Validates that a guest-entered value actually looks like a phone number.
 *
 * Deliberately stricter than "contains enough digits somewhere": an
 * earlier version stripped non-digit characters before counting, so
 * arbitrary free text with 7+ digit characters anywhere in it (e.g. an
 * injection payload padded with a real phone number's digits) would pass.
 * This first rejects the whole string outright if it contains anything
 * other than digits and the handful of punctuation characters real phone
 * numbers are typed with (+, spaces, dashes, dots, parens) — so no other
 * character, including letters or anything resembling a script/formula
 * payload, is ever allowed through — and only then checks the remaining
 * digit count falls in a plausible range.
 */
export function isPlausiblePhone(raw: string): boolean {
  const trimmed = raw.trim();
  if (!/^[0-9+\-.() ]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Normalizes a guest-entered phone number for Twilio, which requires
 * E.164. A bare 10-digit number is assumed US (reasonable default for this
 * event); anything already starting with "+" is passed through as-is.
 */
export function normalizePhone(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("+")) return `+${trimmed.slice(1).replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}
