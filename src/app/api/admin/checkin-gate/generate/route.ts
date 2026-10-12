import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";

/**
 * Admin-only: mints a fresh, random, unguessable party-presence token and
 * stores it, immediately superseding whatever token was there before —
 * there is at most one valid token at a time (see
 * DataStore.setCheckInGateToken). No expiry of its own: the admin is
 * expected to generate a new one fresh the day of the party, and the old
 * one simply stops being the stored value the moment this runs.
 *
 * Returns the raw token so /admin/security can render it as a QR code
 * pointing guests at "/?token=<token>" — see POST
 * /api/auth/checkin-gate/claim, the guest-facing half that checks a
 * presented token against whatever this stored.
 */
export async function POST() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = crypto.randomBytes(24).toString("hex");
  await getDataStore().setCheckInGateToken(token);

  return NextResponse.json({ token });
}
