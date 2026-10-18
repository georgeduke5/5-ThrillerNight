import "server-only";
import twilio from "twilio";
import { isSmsPhone } from "./phoneFormat";

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

/** Refuses outright rather than letting Twilio try a value that isn't a 10-digit US number from toSmsPhone. */
function requireSmsPhone(phone: string): void {
  if (!isSmsPhone(phone)) throw new Error("Not a valid 10-digit phone number; no SMS sent.");
}

export async function sendVerificationCode(phone: string): Promise<void> {
  requireSmsPhone(phone);
  const client = getClient();
  await client.verify.v2
    .services(requireEnv("TWILIO_VERIFY_SERVICE_SID"))
    .verifications.create({ to: phone, channel: "sms" });
}

export async function checkVerificationCode(phone: string, code: string): Promise<boolean> {
  requireSmsPhone(phone);
  const client = getClient();
  const check = await client.verify.v2
    .services(requireEnv("TWILIO_VERIFY_SERVICE_SID"))
    .verificationChecks.create({ to: phone, code });
  return check.status === "approved";
}
