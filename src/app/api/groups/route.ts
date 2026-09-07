import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSessionGuestId } from "@/lib/auth/voterSession";

// Group list changes constantly (guests creating/joining groups) — never cache statically.
export const dynamic = "force-dynamic";

export async function GET() {
  const groups = await getDataStore().getGroups();
  return NextResponse.json({ groups });
}

/**
 * Any phone-verified guest can create a group for themselves (self-service,
 * requirements: "give them the option to create a new group or join an
 * existing one"). The creator is always the caller's own session identity —
 * never a client-supplied id — the same way vote submission derives
 * voterGuestId from the session (see POST /api/votes), so a guest can't
 * create a group "as" someone else by guessing their guest id.
 */
export async function POST(request: NextRequest) {
  const creatorGuestId = await getSessionGuestId();
  if (!creatorGuestId) {
    return NextResponse.json(
      { error: "Phone verification required.", requiresVerification: true },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  const name = body?.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  try {
    const group = await getDataStore().addGroup({ name, creatorGuestId });
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create group." },
      { status: 400 },
    );
  }
}
