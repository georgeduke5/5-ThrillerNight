import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_SESSION_COOKIE = "tn_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
export const ADMIN_SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing required environment variable: SESSION_SECRET.");
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
}

/** Minimal signed-cookie session — no external auth library needed for a single shared admin password. */
export function createSessionToken(): string {
  const payload = JSON.stringify({ role: "admin", exp: Date.now() + SESSION_TTL_MS });
  const encoded = Buffer.from(payload, "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;

  const expectedSignature = sign(encoded);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as {
      role: string;
      exp: number;
    };
    return payload.role === "admin" && payload.exp > Date.now();
  } catch {
    return false;
  }
}

export function verifyAdminPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("Missing required environment variable: ADMIN_PASSWORD.");
  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expected);
  if (candidateBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, expectedBuf);
}

/** For use in server components / layouts / route handlers to gate admin access. */
export async function isAdminRequest(): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}
