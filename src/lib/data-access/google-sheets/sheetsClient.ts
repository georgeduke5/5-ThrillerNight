import "server-only";
import { google, sheets_v4 } from "googleapis";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example for the Google Sheets setup.`,
    );
  }
  return value;
}

let clientPromise: Promise<sheets_v4.Sheets> | null = null;

async function buildClient(): Promise<sheets_v4.Sheets> {
  const email = requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const rawKey = requireEnv("GOOGLE_PRIVATE_KEY");
  // Env vars can't hold real newlines cleanly, so the key is stored with
  // literal "\n" sequences and unescaped here.
  const privateKey = rawKey.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (!clientPromise) clientPromise = buildClient();
  return clientPromise;
}

export function getSpreadsheetId(): string {
  return requireEnv("GOOGLE_SHEET_ID");
}
