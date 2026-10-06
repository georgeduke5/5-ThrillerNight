import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSessionGuestId } from "@/lib/auth/voterSession";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { PublicError } from "@/lib/errors";
import { isValidId } from "@/lib/validation";

/**
 * Adds a guest to a group — either a guest self-joining (omit `guestId`, or
 * pass your own id) or an existing member adding someone else (pass their
 * guest id in `guestId`). The acting guest is always the caller's own
 * session identity, never a client-supplied `actingGuestId` — the same way
 * vote submission derives voterGuestId from the session (see POST
 * /api/votes) — so a guest can't add themselves to (or add others to) a
 * group by guessing someone else's guest id and claiming to be them.
 *
 * An admin (from /admin/groups) has no voter session to derive an acting
 * guest from, and shouldn't be restricted by the "only current members can
 * add others" rule anyway — so for an admin request, `guestId` is required
 * in the body and is passed through as its own actingGuestId, the same
 * self-service bypass DataStore.addGuestToGroup already grants a guest
 * adding themselves.
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

  let guestId: string;
  let actingGuestId: string;
  if (await isAdminRequest()) {
    if (!requestedGuestId) {
      return NextResponse.json({ error: "guestId is required." }, { status: 400 });
    }
    guestId = requestedGuestId;
    actingGuestId = requestedGuestId;
  } else {
    const sessionGuestId = await getSessionGuestId();
    if (!sessionGuestId) {
      return NextResponse.json(
        { error: "Phone verification required.", requiresVerification: true },
        { status: 401 },
      );
    }
    actingGuestId = sessionGuestId;
    // Omitting guestId means "add myself" — the common case (joining a group).
    guestId = requestedGuestId || sessionGuestId;
  }

  try {
    const group = await getDataStore().addGuestToGroup(id, guestId, actingGuestId);
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
