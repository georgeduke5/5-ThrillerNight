import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSessionGuestId } from "@/lib/auth/voterSession";

/**
 * Adds a guest to a group — either a guest self-joining (omit `guestId`, or
 * pass your own id) or an existing member adding someone else (pass their
 * guest id in `guestId`). The acting guest is always the caller's own
 * session identity, never a client-supplied `actingGuestId` — the same way
 * vote submission derives voterGuestId from the session (see POST
 * /api/votes) — so a guest can't add themselves to (or add others to) a
 * group by guessing someone else's guest id and claiming to be them.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actingGuestId = await getSessionGuestId();
  if (!actingGuestId) {
    return NextResponse.json(
      { error: "Phone verification required.", requiresVerification: true },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  // Omitting guestId means "add myself" — the common case (joining a group).
  const guestId = body?.guestId?.trim() || actingGuestId;

  try {
    const group = await getDataStore().addGuestToGroup(id, guestId, actingGuestId);
    return NextResponse.json({ group });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add guest to group.";
    const status = message.startsWith("Group not found")
      ? 404
      : message.startsWith("Guest not found")
        ? 404
        : message === "Only current group members can add other guests."
          ? 403
          : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
