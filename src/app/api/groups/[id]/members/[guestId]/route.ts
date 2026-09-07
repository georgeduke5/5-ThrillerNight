import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminSession";

/** Admin-only — removes a guest from a group without deleting either the guest or the group. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; guestId: string }> },
) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, guestId } = await params;

  try {
    await getDataStore().removeGuestFromGroup(id, guestId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove guest from group.";
    const status =
      message.startsWith("Group not found") || message.startsWith("Guest not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
