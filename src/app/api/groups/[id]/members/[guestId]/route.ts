import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { PublicError } from "@/lib/errors";
import { isValidId } from "@/lib/validation";

/** Admin-only — removes a guest from a group without deleting either the guest or the group. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; guestId: string }> },
) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, guestId } = await params;
  if (!isValidId(id) || !isValidId(guestId)) {
    return NextResponse.json({ error: "Group or guest not found." }, { status: 404 });
  }

  try {
    await getDataStore().removeGuestFromGroup(id, guestId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PublicError) {
      const status =
        err.message.startsWith("Group not found") || err.message.startsWith("Guest not found") ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("Failed to remove guest from group:", err);
    return NextResponse.json({ error: "Failed to remove guest from group." }, { status: 500 });
  }
}
