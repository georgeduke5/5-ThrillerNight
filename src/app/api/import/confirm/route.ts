import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { validateGuestFields } from "@/lib/csv-import/importGuests";
import type { ImportedGuest } from "@/lib/csv-import/types";

// Plenty for a real guest list (the CSV importer's own upload cap is 2MB —
// see MAX_CSV_BYTES in /api/import); guards against a malformed or
// deliberately huge confirm payload forcing an equally huge batch write.
const MAX_GUESTS_PER_IMPORT = 1000;

/**
 * Stage two of the CSV importer: the admin has reviewed the validated
 * rows. This is the only step that actually writes, and it goes through
 * the data access layer's addGuests() like any other guest write — which
 * is also where each phone number is encrypted (see guestToRow /
 * phoneEncryption.ts). Every entry is re-validated here with the same
 * rules as the upload step, since the payload comes back from the client.
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

  const guests: ImportedGuest[] = [];
  for (const [index, entry] of rawGuests.entries()) {
    const candidate = (entry ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value : "");
    const result = validateGuestFields({
      firstName: text(candidate.firstName),
      lastName: text(candidate.lastName),
      category: text(candidate.category),
      phone: text(candidate.phone),
    });
    if ("problems" in result) {
      return NextResponse.json(
        { error: `Guest ${index + 1}: ${result.problems.join("; ")}.` },
        { status: 400 },
      );
    }
    guests.push(result.guest);
  }

  const created = await getDataStore().addGuests(
    guests.map((g) => ({ ...g, source: "csv-import" as const })),
  );

  return NextResponse.json({ guests: created }, { status: 201 });
}
