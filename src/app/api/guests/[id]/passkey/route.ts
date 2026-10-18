import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { revokeGuestSessions } from "@/lib/auth/sessionRevocation";
import { isValidId } from "@/lib/validation";

/**
 * Admin-only — removes a guest's passkey entirely (DataStore.deletePasskey),
 * the only way to clear the one-passkey-per-guest rule enforced at
 * registration (see GoogleSheetsDataStore.savePasskey and
 * POST /api/auth/passkey/begin/finish). Re-opens registration for this
 * guest immediately: their very next POST /api/auth/passkey/begin call
 * sees no existing credential and offers a fresh registration ceremony.
 *
 * Also revokes every session this guest currently holds, on any browser
 * (see sessionRevocation.ts) — the passkey that established those
 * sessions no longer exists, so they shouldn't outlive it. A guest signed
 * in right now is signed out on their very next request, the same as any
 * other server-side logout.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  // An admin's passkey is never removed: re-registering puts a guest with
  // no phone back to pending, and with no other admin to approve them that
  // locks the admin panel. Unmark them as admin in the Guests sheet first.
  const target = await getDataStore().getGuestById(id);
  if (target?.isAdmin) {
    return NextResponse.json(
      { error: "Admins' passkeys can't be removed. Unmark them as admin in the Guests sheet first." },
      { status: 403 },
    );
  }

  // Removing the credential and putting the guest back to pending are one
  // step: a checked-in guest with no passkey could otherwise be claimed by
  // anyone who registers a new one under their name.
  const removed = await getDataStore().removePasskeyAndResetToPending(id);
  revokeGuestSessions(id);

  return NextResponse.json({ ok: true, removed });
}
