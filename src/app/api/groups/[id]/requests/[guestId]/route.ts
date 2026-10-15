import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { requireCheckedInGuest } from "@/lib/auth/participant";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { PublicError } from "@/lib/errors";
import { isValidId } from "@/lib/validation";

/**
 * Answers a pending request to join a group (see POST
 * /api/groups/[id]/members). `{ action: "approve" | "decline" }`.
 *
 * Only the group's creator (getGroupApproverId) or an admin can approve.
 * The same people can decline, and so can the requester, to withdraw their
 * own request. Who's acting always comes from the session, never the body,
 * and a pending session can't act at all.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; guestId: string }> },
) {
  const { id, guestId } = await params;
  if (!isValidId(id) || !isValidId(guestId)) {
    return NextResponse.json({ error: "Group or guest not found." }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;
  if (action !== "approve" && action !== "decline") {
    return NextResponse.json({ error: "action must be 'approve' or 'decline'." }, { status: 400 });
  }

  let actingGuestId: string | null = null;
  if (!(await isAdminRequest())) {
    const caller = await requireCheckedInGuest();
    if ("response" in caller) return caller.response;
    actingGuestId = caller.guestId;
  }

  try {
    const group = await getDataStore().resolveGroupJoinRequest(id, guestId, actingGuestId, action === "approve");
    return NextResponse.json({ group });
  } catch (err) {
    if (err instanceof PublicError) {
      const status = err.message.startsWith("Group not found")
        ? 404
        : err.message === "Only the group's creator can answer join requests."
          ? 403
          : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("Failed to resolve group join request:", err);
    return NextResponse.json({ error: "Failed to update the request." }, { status: 500 });
  }
}
