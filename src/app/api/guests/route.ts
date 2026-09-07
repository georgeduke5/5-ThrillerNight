import { NextRequest, NextResponse } from "next/server";
import { getDataStore, type Guest } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminSession";
import type { GuestBracket } from "@/lib/config/types";

// Guest list changes constantly (walk-ins, admin edits) — never cache statically.
export const dynamic = "force-dynamic";

/** What the voting/nominee UI actually needs — see CategoryVoteCard, VotingApp, GroupPanel, CheckInButton. */
type PublicGuest = Pick<Guest, "id" | "firstName" | "lastName" | "bracket" | "photoUrl" | "groupId">;

function toPublicGuest(guest: Guest): PublicGuest {
  const { id, firstName, lastName, bracket, photoUrl, groupId } = guest;
  return { id, firstName, lastName, bracket, photoUrl, groupId };
}

/**
 * Public endpoint — anyone browsing /vote can call this with no session, so
 * it must never leak admin-only fields (phone, source, createdAt,
 * checkedInAt, photoRef) to unauthenticated callers. Admins get the full
 * record since the admin Guests page may need it; everyone else gets the
 * minimal public shape.
 */
export async function GET() {
  const guests = await getDataStore().getGuests();
  if (await isAdminRequest()) {
    return NextResponse.json({ guests });
  }
  return NextResponse.json({ guests: guests.map(toPublicGuest) });
}

function isValidBracket(value: unknown): value is GuestBracket {
  return value === "adult-male" || value === "adult-female" || value === "boy" || value === "girl";
}

/** Admin-only manual guest entry (requirements Section 5.1/5.4). */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    firstName?: string;
    lastName?: string;
    bracket?: string;
    phone?: string;
  } | null;

  const firstName = body?.firstName?.trim();
  const lastName = body?.lastName?.trim();
  const bracket = body?.bracket;

  if (!firstName || !lastName || !isValidBracket(bracket)) {
    return NextResponse.json(
      {
        error:
          "firstName, lastName, and a valid bracket ('adult-male' | 'adult-female' | 'boy' | 'girl') are required.",
      },
      { status: 400 },
    );
  }

  const guest = await getDataStore().addGuest({
    firstName,
    lastName,
    bracket,
    source: "manual",
    phone: body?.phone?.trim() || null,
  });

  return NextResponse.json({ guest }, { status: 201 });
}
