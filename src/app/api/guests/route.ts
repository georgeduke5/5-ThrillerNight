import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminSession";
import type { GuestBracket } from "@/lib/config/types";

// Guest list changes constantly (walk-ins, admin edits) — never cache statically.
export const dynamic = "force-dynamic";

export async function GET() {
  const guests = await getDataStore().getGuests();
  return NextResponse.json({ guests });
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
  });

  return NextResponse.json({ guest }, { status: 201 });
}
