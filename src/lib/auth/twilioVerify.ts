import "server-only";
import twilio from "twilio";
import type { DataStore } from "@/lib/data-access";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}. See .env.example for the Twilio setup.`);
  }
  return value;
}

let clientPromise: ReturnType<typeof twilio> | null = null;

function getClient(): ReturnType<typeof twilio> {
  if (!clientPromise) {
    clientPromise = twilio(requireEnv("TWILIO_ACCOUNT_SID"), requireEnv("TWILIO_AUTH_TOKEN"));
  }
  return clientPromise;
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

export async function sendVerificationCode(phone: string): Promise<void> {
  const client = getClient();
  await client.verify.v2
    .services(requireEnv("TWILIO_VERIFY_SERVICE_SID"))
    .verifications.create({ to: phone, channel: "sms" });
}

export async function checkVerificationCode(phone: string, code: string): Promise<boolean> {
  const client = getClient();
  const check = await client.verify.v2
    .services(requireEnv("TWILIO_VERIFY_SERVICE_SID"))
    .verificationChecks.create({ to: phone, code });
  return check.status === "approved";
}

/** Loose sanity check on a guest-entered phone number, shared by every flow that accepts one directly from a guest. */
export function isPlausiblePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * True if some OTHER guest already has this phone number on file — checked
 * before letting a guest newly claim a number as their own durable fallback
 * credential (see .../passkey/fallback/start and /verify), so one phone
 * number can never end up able to re-authenticate as two different guest
 * identities.
 */
export async function isPhoneTakenByAnotherGuest(
  store: DataStore,
  phone: string,
  excludeGuestId: string,
): Promise<boolean> {
  const normalized = normalizePhone(phone);
  const guests = await store.getGuests();
  return guests.some((g) => g.id !== excludeGuestId && g.phone && normalizePhone(g.phone) === normalized);
}
