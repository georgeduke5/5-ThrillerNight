import "server-only";
import crypto from "node:crypto";

/**
 * Field-level encryption for Guest.phone at rest in the Sheet — AES-256-GCM
 * with a fresh random IV per call, so the same number never produces the
 * same ciphertext twice (defeats a simple "which rows share this number"
 * comparison on the raw Sheet data, and makes the ciphertext itself
 * unguessable even for a known/short number). This is the only place phone
 * numbers are encrypted or decrypted — GoogleSheetsDataStore's rowToGuest/
 * guestToRow call straight into this module at the Sheet read/write
 * boundary, so every write path (check-in's self-service "Update my info",
 * walk-in registration, CSV import, admin edits) goes through it
 * automatically with no per-call-site opt-in required, and the rest of the
 * app only ever sees a plain decrypted Guest.phone string — the one
 * boundary where a plaintext number could leak into a log line is this
 * module's own error paths, which is why none of them below ever include
 * the plaintext or ciphertext value in a thrown message.
 *
 * Lookup-by-phone tradeoff (nothing in this app currently looks a guest up
 * BY phone number — identity is always resolved by guestId first, and
 * phone is only ever read for a specific already-known guest to send/
 * compare a Twilio Verify code; fallback/start.ts's own comment notes
 * duplicate numbers across guests are expected and never deduped). Since
 * GCM ciphertext differs every time, a future "find the guest with this
 * phone number" feature can't compare ciphertext directly. Two options:
 *   1. Decrypt-and-compare: loop the guest list server-side, decrypt each
 *      stored number, compare to the (normalized) input.
 *   2. A separate HMAC-SHA256(phone) column as a blind index, matched by
 *      equality without decrypting anything.
 * Decrypt-and-compare is the better fit here: this is a single private
 * event's guest list (dozens to low hundreds of rows), where decrypting
 * every row is sub-millisecond and adds no new secret-derived column to
 * keep in sync on every write and include in the migration. An HMAC index
 * only earns its keep at a scale where O(n) decryption is actually slow, or
 * where the lookup needs a real database index rather than a server-side
 * scan — neither applies here. If a phone-lookup feature is ever added,
 * decrypt-and-compare inside the DataStore (next to getGuestById) is the
 * right place for it.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // 96-bit IV — the standard/recommended size for GCM
const AUTH_TAG_LENGTH_BYTES = 16;
const ENCRYPTED_PREFIX = "enc:v1:";

/**
 * Undoes the two most common ways a hex secret gets mangled going into an
 * env var: a trailing newline left by whatever wrote the .env file or
 * dashboard field, and a shell/editor adding a surrounding pair of quotes
 * (e.g. pasting `PHONE_ENCRYPTION_KEY="abc...xyz"` verbatim). Only strips
 * one matching pair — a key that's legitimately quote-wrapped twice, or
 * asymmetrically, is left alone and will fail the hex/length check below
 * with an honest error rather than being guessed at further.
 */
function normalizeKeyInput(raw: string): string {
  let value = raw.trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  return value;
}

function loadKey(): Buffer {
  const rawEnv = process.env.PHONE_ENCRYPTION_KEY;
  if (!rawEnv) {
    throw new Error(
      "Missing required environment variable: PHONE_ENCRYPTION_KEY. Generate one with: openssl rand -hex 32",
    );
  }

  const value = normalizeKeyInput(rawEnv);
  const nonHexCount = (value.match(/[^0-9a-fA-F]/g) ?? []).length;

  if (value.length !== KEY_LENGTH_BYTES * 2 || nonHexCount > 0) {
    // Reports shape only (length, how many characters aren't hex) — never
    // the value, or any slice of it, which would defeat the point of
    // keeping this out of logs/error messages in the first place.
    throw new Error(
      `PHONE_ENCRYPTION_KEY must be a ${KEY_LENGTH_BYTES * 2}-character hex string ` +
        `(${KEY_LENGTH_BYTES} bytes) for AES-256-GCM. Received a value of length ${value.length} ` +
        `with ${nonHexCount} non-hex character(s). Generate one with: openssl rand -hex 32`,
    );
  }

  return Buffer.from(value, "hex");
}

// Loaded and validated once, at module-evaluation time rather than lazily
// inside encryptPhone/decryptPhone — a missing or malformed key fails the
// moment this module is first imported (effectively "at startup" in a
// serverless deployment, since nothing imports this without also importing
// GoogleSheetsDataStore.ts) instead of only being discovered the first
// time a guest's phone number happens to be written or read.
const KEY = loadKey();

/**
 * Encrypts plaintext with a fresh random IV, returning a single
 * self-contained string safe to store in a Sheets cell: the fixed "enc:v1:"
 * prefix guarantees it never starts with a formula-trigger character
 * (=, +, -, @ — see sanitizeForSheets.ts), so no separate sanitization step
 * is needed for the encrypted form the way the plaintext required.
 */
export function encryptPhone(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENCRYPTED_PREFIX + Buffer.concat([iv, ciphertext, authTag]).toString("base64");
}

/** True if value looks like something encryptPhone produced, vs. a legacy plaintext cell from before this existed (see GoogleSheetsDataStore's rowToGuest). */
export function isEncryptedPhone(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Reverses encryptPhone. Throws — never returns garbled-but-plausible
 * text — if value isn't well-formed for this key: a wrong key or any
 * tampered byte (IV, ciphertext, or tag) fails AES-GCM's built-in
 * authentication check inside decipher.final() before any plaintext is
 * produced. Never includes the attempted plaintext, or the ciphertext
 * itself, in a thrown message.
 */
export function decryptPhone(value: string): string {
  if (!isEncryptedPhone(value)) {
    throw new Error("Not a recognized encrypted-phone value.");
  }
  const raw = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), "base64");
  if (raw.length < IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES) {
    throw new Error("Malformed encrypted-phone value: too short.");
  }

  const iv = raw.subarray(0, IV_LENGTH_BYTES);
  const authTag = raw.subarray(raw.length - AUTH_TAG_LENGTH_BYTES);
  const ciphertext = raw.subarray(IV_LENGTH_BYTES, raw.length - AUTH_TAG_LENGTH_BYTES);

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf-8");
}
