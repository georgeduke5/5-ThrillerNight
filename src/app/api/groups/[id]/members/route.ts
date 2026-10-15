import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { requireCheckedInGuest } from "@/lib/auth/participant";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { PublicError } from "@/lib/errors";
import { isValidId } from "@/lib/validation";

/**
 * Adds a guest to a group, or asks to join one:
 *
 * - An existing member adding someone else (pass their id in `guestId`) is
 *   a direct add — no approval needed, same as creating a group.
 * - Joining on your own (omit `guestId`, or pass your own id) only files a
 *   request (Group.pendingMemberIds). You aren't a member — so you can't
 *   vote as the group or change its photo — until the group's creator
 *   approves it (POST /api/groups/[id]/requests/[guestId]). Responds 202.
 *
 * The acting guest is always the caller's own session, never a
 * client-supplied id, and must be fully checked in — a pending session is
 * read-only. An admin (from /admin/groups) names `guestId` explicitly and
 * adds them directly.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const requestedGuestId = body?.guestId?.trim();
  if (requestedGuestId !== undefined && requestedGuestId !== "" && !isValidId(requestedGuestId)) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const store = getDataStore();
  try {
    if (await isAdminRequest()) {
      if (!requestedGuestId) {
        return NextResponse.json({ error: "guestId is required." }, { status: 400 });
      }
      const group = await store.addGuestToGroup(id, requestedGuestId, null);
      return NextResponse.json({ group });
    }

    const caller = await requireCheckedInGuest();
    if ("response" in caller) return caller.response;

    if (!requestedGuestId || requestedGuestId === caller.guestId) {
      const group = await store.requestToJoinGroup(id, caller.guestId);
      return NextResponse.json({ group, requested: true }, { status: 202 });
    }

    const group = await store.addGuestToGroup(id, requestedGuestId, caller.guestId);
    return NextResponse.json({ group });
  } catch (err) {
    if (err instanceof PublicError) {
      const status = err.message.startsWith("Group not found")
        ? 404
        : err.message.startsWith("Guest not found")
          ? 404
          : err.message === "Only current group members can add other guests."
            ? 403
            : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("Failed to add guest to group:", err);
    return NextResponse.json({ error: "Failed to add guest to group." }, { status: 500 });
  }
}
