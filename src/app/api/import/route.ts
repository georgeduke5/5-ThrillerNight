import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/auth/adminSession";
import { parseCsvForImport } from "@/lib/csv-import/importGuests";
import { csvMappers } from "@/lib/csv-import/mappers";

/** Lists supported CSV source formats for the admin import UI. */
export async function GET() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ mappers: csvMappers.map((m) => ({ id: m.id, label: m.label })) });
}

/**
 * Stage one of the CSV importer (requirements Section 5.1): parses the
 * uploaded file into guest candidates for admin review. Nothing is written
 * through the data access layer here — see /api/import/confirm.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const mapperId = formData?.get("mapperId");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "A CSV file is required (form field 'file')." },
      { status: 400 },
    );
  }

  const content = await file.text();

  try {
    const result = parseCsvForImport(content, typeof mapperId === "string" ? mapperId : undefined);
    if (result.candidates.length === 0) {
      return NextResponse.json(
        { error: "No guest rows were found in this file." },
        { status: 400 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to parse CSV." },
      { status: 400 },
    );
  }
}
