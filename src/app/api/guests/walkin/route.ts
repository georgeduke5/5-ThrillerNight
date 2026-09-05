import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import type { GuestBracket } from "@/lib/config/types";

function isValidBracket(value: unknown): value is GuestBracket {
  return value === "adult-male" || value === "adult-female" || value === "boy" || value === "girl";
}

/**
 * Public endpoint behind the "walk-in guest" QR code (requirements Section
 * 5.2): lets an unlisted guest add themselves to the guest/nominee list on
 * the spot with a minimal name + bracket entry, standing in for a full
 * RSVP this year. "Couple/Group" is deliberately not a valid bracket here —
 * guests only ever self-register into one of the four individual brackets.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    firstName?: string;
    lastName?: string;
    bracket?: string;
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
    source: "walk-in",
  });

  return NextResponse.json({ guest }, { status: 201 });
}
