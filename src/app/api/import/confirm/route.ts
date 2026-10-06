import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { isValidShortText } from "@/lib/validation";
import type { GuestBracket } from "@/lib/config/types";

function isValidBracket(value: unknown): value is GuestBracket {
  return value === "adult-male" || value === "adult-female" || value === "boy" || value === "girl";
}

interface ConfirmedGuest {
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
}

// Plenty for a real guest list (the CSV importer's own upload cap is 2MB —
// see MAX_CSV_BYTES in /api/import); guards against a malformed or
// deliberately huge confirm payload forcing an equally huge batch write.
const MAX_GUESTS_PER_IMPORT = 1000;

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
  if (rawGuests.length > MAX_GUESTS_PER_IMPORT) {
    return NextResponse.json(
      { error: `At most ${MAX_GUESTS_PER_IMPORT} guests can be imported at once.` },
      { status: 400 },
    );
  }

  const guests: ConfirmedGuest[] = [];
  for (const entry of rawGuests) {
    const candidate = entry as { firstName?: unknown; lastName?: unknown; bracket?: unknown };
    if (!isValidShortText(candidate.firstName) || !isValidShortText(candidate.lastName) || !isValidBracket(candidate.bracket)) {
      return NextResponse.json(
        {
          error:
            "Each guest needs firstName, lastName, and bracket ('adult-male' | 'adult-female' | 'boy' | 'girl').",
        },
        { status: 400 },
      );
    }
    guests.push({ firstName: candidate.firstName.trim(), lastName: candidate.lastName.trim(), bracket: candidate.bracket });
  }

  const created = await getDataStore().addGuests(
    guests.map((g) => ({ ...g, source: "evite-import" as const })),
  );

  return NextResponse.json({ guests: created }, { status: 201 });
}
