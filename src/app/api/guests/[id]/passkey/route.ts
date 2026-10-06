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

  const removed = await getDataStore().deletePasskey(id);
  revokeGuestSessions(id);

  return NextResponse.json({ ok: true, removed });
}
