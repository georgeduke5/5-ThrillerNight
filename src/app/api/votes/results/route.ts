import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSiteConfig } from "@/lib/config";
import { computeResults } from "@/lib/data-access/results";
import { isAdminRequest } from "@/lib/auth/adminSession";

/**
 * Live tallied results. Admins can always see them (requirements Section
 * 5.4: "admins can privately view live tallied results at any time");
 * everyone else only once resultsPublished is true.
 */
export async function GET() {
  const config = getSiteConfig();
  const store = getDataStore();
  const status = await store.getVotingStatus();

  const admin = await isAdminRequest();
  if (!admin && !status.resultsPublished) {
    return NextResponse.json({ error: "Results have not been published yet." }, { status: 403 });
  }

  const [guests, groups, votes] = await Promise.all([
    store.getGuests(),
    store.getGroups(),
    store.getVotes(),
  ]);
  const results = computeResults(guests, groups, votes, config.voting.categories);

  return NextResponse.json({ results, status });
}
