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
 * The one rule for whether a stored phone value is a number we can text:
 * a real 10-digit US number, typed with any of the usual punctuation and
 * an optional leading 1 / +1 country code. Returns it in E.164
 * (+1XXXXXXXXXX), the form Twilio needs, or null for anything else: a
 * blank, a placeholder like "no phone" or "n/a", too few or too many
 * digits, a non-US number, or garbage. Every caller treats null exactly
 * like no phone on file, so bad data in the Guests sheet can never reach
 * an SMS send.
 */
export function toSmsPhone(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!/^\+?[0-9\-.() ]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10 && !trimmed.startsWith("+")) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** True for exactly the E.164 form toSmsPhone returns — the last check before anything is sent to Twilio. */
export function isSmsPhone(value: string): boolean {
  return /^\+1\d{10}$/.test(value);
}
