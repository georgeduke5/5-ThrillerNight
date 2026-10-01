import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";

/**
 * Admin actions on a "pending approval" guest from /admin/check-in (see
 * Guest.pendingApprovalAt) — approve checks them in as normal, reject
 * deletes their passkey registration entirely so the real guest can
 * register correctly under their own name from scratch.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    guestId?: string;
    action?: "approve" | "reject";
  } | null;
  const guestId = body?.guestId;
  const action = body?.action;
  if (!guestId || (action !== "approve" && action !== "reject")) {
    return NextResponse.json({ error: "guestId and a valid action are required." }, { status: 400 });
  }

  const store = getDataStore();
  try {
    if (action === "approve") {
      await store.approvePendingGuest(guestId);
    } else {
      await store.rejectPendingGuest(guestId);
    }
  } catch {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
