import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { computeCandyResults } from "@/lib/data-access/candyResults";
import { isAdminRequest } from "@/lib/auth/adminAccess";

/**
 * Live computed candy-count results. Mirrors GET /api/votes/results: admins
 * can always see them (once a true count is entered) — "admins can
 * privately view results at any time" — everyone else only once
 * resultsPublished is true.
 */
export async function GET() {
  const store = getDataStore();
  const status = await store.getCandyCountStatus();

  const admin = await isAdminRequest();
  if (!admin && !status.resultsPublished) {
    return NextResponse.json({ error: "Results have not been published yet." }, { status: 403 });
  }

  if (status.trueCount === null) {
    return NextResponse.json({ results: null, status });
  }

  const [guesses, guests] = await Promise.all([store.getCandyGuesses(), store.getGuests()]);
  const results = computeCandyResults(guesses, guests, status.trueCount);

  return NextResponse.json({ results, status });
}
