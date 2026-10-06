import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSessionGuestId } from "@/lib/auth/voterSession";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { PublicError } from "@/lib/errors";
import { isValidId, isValidShortText } from "@/lib/validation";

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
 *
 * An admin can also create a group on a guest's behalf (from /admin/groups)
 * by explicitly naming that guest as `creatorGuestId` in the body — there's
 * no session to derive it from in the admin panel, so this is the one case
 * a client-supplied id is trusted, gated on isAdminRequest() rather than a
 * voter session.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    creatorGuestId?: string;
  } | null;
  const rawName = body?.name;
  if (!isValidShortText(rawName)) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }
  const name = rawName.trim();

  let creatorGuestId: string | null;
  if (await isAdminRequest()) {
    const requestedCreatorGuestId = body?.creatorGuestId?.trim();
    if (!isValidId(requestedCreatorGuestId)) {
      return NextResponse.json({ error: "creatorGuestId is required." }, { status: 400 });
    }
    creatorGuestId = requestedCreatorGuestId;
  } else {
    creatorGuestId = await getSessionGuestId();
    if (!creatorGuestId) {
      return NextResponse.json(
        { error: "Phone verification required.", requiresVerification: true },
        { status: 401 },
      );
    }
  }

  try {
    const group = await getDataStore().addGroup({ name, creatorGuestId });
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    if (err instanceof PublicError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Anything else (a raw Sheets API failure, etc.) could carry internal
    // details — log it server-side, never forward it to the caller.
    console.error("Failed to create group:", err);
    return NextResponse.json({ error: "Failed to create group." }, { status: 500 });
  }
}
