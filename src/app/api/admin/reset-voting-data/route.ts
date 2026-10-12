import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";

/**
 * Admin-only, destructive: "Remove all voting and guessing data" on
 * /admin/security's Danger Zone. Blanks every row in both the Votes and
 * CandyGuesses sheets (DataStore.clearVotesAndCandyGuesses) — every costume
 * vote and every candy-count guess, nothing else. Guests, groups, settings,
 * and passkeys are untouched; a guest's checked-in/pending-approval status
 * and their registered passkey both survive this unchanged, so re-voting
 * after this runs doesn't require re-verifying.
 *
 * SheetTable's own write path already invalidates the 10s read cache for
 * both tabs as each row is blanked (see sheetReadCache.ts) — nothing extra
 * to invalidate here.
 */
export async function POST() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getDataStore().clearVotesAndCandyGuesses();
  return NextResponse.json({ ok: true, ...result });
}
