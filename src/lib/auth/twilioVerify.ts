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
