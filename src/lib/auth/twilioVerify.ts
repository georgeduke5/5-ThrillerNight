import "server-only";
import twilio from "twilio";

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
