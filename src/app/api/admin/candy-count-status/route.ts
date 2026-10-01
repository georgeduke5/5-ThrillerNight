import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";

/**
 * Admin controls for the candy count contest (mirrors
 * POST /api/admin/voting-status) — a deliberately separate endpoint, not
 * folded into that one, since this is a deliberately separate feature with
 * its own separate admin page. guessingOpen, resultsPublished, and
 * trueCount are independent flags for the same reason isOpen/
 * resultsPublished are on the voting side: closing guessing doesn't publish
 * results, and entering the true count doesn't publish it either — an
 * admin can privately check the standings before deciding to reveal them.
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    guessingOpen?: boolean;
    resultsPublished?: boolean;
    trueCount?: number | null;
  } | null;

  const store = getDataStore();
  if (body?.guessingOpen !== undefined) {
    await store.setCandyGuessingOpen(Boolean(body.guessingOpen));
  }
  if (body?.resultsPublished !== undefined) {
    await store.setCandyResultsPublished(Boolean(body.resultsPublished));
  }
  if (body?.trueCount !== undefined) {
    if (body.trueCount !== null) {
      if (
        typeof body.trueCount !== "number" ||
        !Number.isInteger(body.trueCount) ||
        body.trueCount < 0
      ) {
        return NextResponse.json(
          { error: "True count must be a non-negative whole number." },
          { status: 400 },
        );
      }
    }
    await store.setCandyTrueCount(body.trueCount);
  }

  const status = await store.getCandyCountStatus();
  return NextResponse.json(status);
}
