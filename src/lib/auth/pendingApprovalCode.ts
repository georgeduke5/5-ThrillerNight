import "server-only";
import crypto from "node:crypto";
import type { Guest } from "@/lib/data-access";

/**
 * A short code tying an admin's approval to the specific device that filed a
 * pending check-in request (see Guest.pendingApprovalAt). Approval unlocks
 * whichever browser holds that pending guest's session, and that's whoever
 * *filed* the request — not necessarily the person standing in front of the
 * admin. So /check-in/pending shows this code on the requester's screen,
 * /admin/check-in shows the same code next to the guest's name, and the
 * admin approves only when the two match.
 *
 * Derived, not stored: an HMAC (keyed on SESSION_SECRET) over the guest id
 * and the request's own pendingApprovalAt timestamp. No extra sheet column,
 * nothing the client can choose, and every new request (a fresh
 * pendingApprovalAt after a reject) gets a fresh code.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I — read aloud at a loud party
const CODE_LENGTH = 4;

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing required environment variable: SESSION_SECRET.");
  return secret;
}

export function getPendingApprovalCode(guest: Pick<Guest, "id" | "pendingApprovalAt">): string | null {
  if (!guest.pendingApprovalAt) return null;
  const digest = crypto
    .createHmac("sha256", getSecret())
    .update(`pending-approval-code:${guest.id}:${guest.pendingApprovalAt}`)
    .digest();
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[(digest[i] ?? 0) % ALPHABET.length];
  return code;
}
