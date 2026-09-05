import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminSession";
import type { GuestBracket } from "@/lib/config/types";

function isValidBracket(value: unknown): value is GuestBracket {
  return value === "adult-male" || value === "adult-female" || value === "boy" || value === "girl";
}

interface ConfirmedGuest {
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
}

/**
 * Stage two of the CSV importer: the admin has reviewed the parsed
 * candidates and assigned a bracket to each (Evite exports don't include
 * one — requirements Section 5.1). This is the only step that actually
 * writes, and it goes through the data access layer like any other guest
 * write.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { guests?: unknown } | null;
  const rawGuests = body?.guests;
  if (!Array.isArray(rawGuests) || rawGuests.length === 0) {
    return NextResponse.json({ error: "guests must be a non-empty array." }, { status: 400 });
  }

  const guests: ConfirmedGuest[] = [];
  for (const entry of rawGuests) {
    const candidate = entry as { firstName?: unknown; lastName?: unknown; bracket?: unknown };
    const firstName = typeof candidate.firstName === "string" ? candidate.firstName.trim() : "";
    const lastName = typeof candidate.lastName === "string" ? candidate.lastName.trim() : "";
    if (!firstName || !lastName || !isValidBracket(candidate.bracket)) {
      return NextResponse.json(
        {
          error:
            "Each guest needs firstName, lastName, and bracket ('adult-male' | 'adult-female' | 'boy' | 'girl').",
        },
        { status: 400 },
      );
    }
    guests.push({ firstName, lastName, bracket: candidate.bracket });
  }

  const created = await getDataStore().addGuests(
    guests.map((g) => ({ ...g, source: "evite-import" as const })),
  );

  return NextResponse.json({ guests: created }, { status: 201 });
}
