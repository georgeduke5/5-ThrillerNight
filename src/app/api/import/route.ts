import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { parseCsvForImport } from "@/lib/csv-import/importGuests";

const MAX_CSV_BYTES = 2 * 1024 * 1024; // 2MB — plenty for a guest list

/**
 * Stage one of the CSV importer: parses and validates the uploaded file
 * (First Name, Last Name, Category, Phone Number — see importGuests.ts)
 * for admin review. Any invalid row fails the whole file with a per-row
 * error list, so bad data never reaches the review step. Nothing is
 * written through the data access layer here — see /api/import/confirm.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "A CSV file is required (form field 'file')." },
      { status: 400 },
    );
  }

  if (file.size > MAX_CSV_BYTES) {
    return NextResponse.json({ error: "CSV file is too large (max 2MB)." }, { status: 400 });
  }

  const content = await file.text();

  try {
    const { guests, errors } = parseCsvForImport(content);
    if (errors.length > 0) {
      return NextResponse.json(
        {
          error: `${errors.length} row(s) have problems. Fix them and upload the file again — nothing was imported.`,
          rowErrors: errors,
        },
        { status: 400 },
      );
    }
    if (guests.length === 0) {
      return NextResponse.json(
        { error: "No guest rows were found in this file." },
        { status: 400 },
      );
    }
    return NextResponse.json({ guests });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse CSV." },
      { status: 400 },
    );
  }
}
