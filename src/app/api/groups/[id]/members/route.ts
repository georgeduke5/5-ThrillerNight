import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";

/**
 * Adds a guest to a group — either a guest self-joining (guestId ===
 * actingGuestId, always allowed) or an existing member adding someone else
 * (actingGuestId must already be a member). Public — identified by body
 * fields, not by who's calling, matching the rest of the guest-facing API.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const body = (await request.json().catch(() => null)) as {
    guestId?: string;
    actingGuestId?: string;
  } | null;

  const guestId = body?.guestId;
  const actingGuestId = body?.actingGuestId;

  if (!guestId || !actingGuestId) {
    return NextResponse.json({ error: "guestId and actingGuestId are required." }, { status: 400 });
  }

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
