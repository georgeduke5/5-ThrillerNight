import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getEligibleNominees } from "@/lib/nomineeEligibility";

export const dynamic = "force-dynamic";

/**
 * The guest and group ids that can currently be nominated (see
 * nomineeEligibility.ts): checked-in guests, and groups with at least one
 * checked-in member. The voting galleries show only these. Just ids, so
 * no check-in timestamps reach the public; the guest list itself stays
 * unfiltered, since check-in name search needs every guest.
 */
export async function GET() {
  const store = getDataStore();
  const [guests, groups] = await Promise.all([store.getGuests(), store.getGroups()]);
  const { guestIds, groupIds } = getEligibleNominees(guests, groups);
  return NextResponse.json({ guestIds: [...guestIds], groupIds: [...groupIds] });
}
