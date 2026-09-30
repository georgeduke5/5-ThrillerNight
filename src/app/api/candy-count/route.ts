import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSiteConfig } from "@/lib/config";
import { getSessionGuestId } from "@/lib/auth/voterSession";

/** Upper bound sanity check — no candy jar contest is plausibly this large; guards against garbage input corrupting the sheet. */
const MAX_REASONABLE_GUESS = 100_000;

/**
 * Returns the current session's identity (if any) plus that guest's own
 * previously submitted guess (never anyone else's) — same open-browsing,
 * identity-from-session-cookie-only pattern as GET /api/votes. No
 * verification required to call this, only to submit (POST below).
 */
export async function GET() {
  const config = getSiteConfig();
  if (!config.features.candyCountModuleEnabled) {
    return NextResponse.json({ error: "Candy count contest is disabled." }, { status: 404 });
  }

  const guestId = await getSessionGuestId();
  if (!guestId) {
    return NextResponse.json({ guestId: null, guess: null });
  }

  const existing = await getDataStore().getCandyGuessByGuestId(guestId);
  return NextResponse.json({ guestId, guess: existing?.guess ?? null });
}

/**
 * Validates and records (or overwrites) the current session's guess.
 * Identity-based, not device-based, same as POST /api/votes: a repeat
 * submission overwrites the prior guess (DataStore.recordCandyGuess is an
 * upsert) rather than creating a second entry. Who's guessing comes solely
 * from the verified session cookie — never from the request body — so
 * there's no client-suppliable guestId at all.
 *
 * Every validation rule here is re-checked from scratch — the client's own
 * validation (same rules, for instant feedback) is never trusted alone.
 */
export async function POST(request: NextRequest) {
  const config = getSiteConfig();
  if (!config.features.candyCountModuleEnabled) {
    return NextResponse.json({ error: "Candy count contest is disabled." }, { status: 404 });
  }

  const store = getDataStore();
  const status = await store.getCandyCountStatus();
  if (!status.guessingOpen) {
    return NextResponse.json({ error: "Guessing is currently closed." }, { status: 403 });
  }

  const guestId = await getSessionGuestId();
  if (!guestId) {
    return NextResponse.json(
      { error: "Verification required.", requiresVerification: true },
      { status: 401 },
    );
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    // The session cookie is valid but the guest record it points to is
    // gone — treat as unverified rather than crashing.
    return NextResponse.json(
      { error: "Verification required.", requiresVerification: true },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as { guess?: unknown } | null;
  const rawGuess = body?.guess;

  if (typeof rawGuess !== "number" || !Number.isFinite(rawGuess)) {
    return NextResponse.json({ error: "Enter a whole number." }, { status: 400 });
  }
  if (!Number.isInteger(rawGuess)) {
    return NextResponse.json(
      { error: "Guess must be a whole number — no decimals." },
      { status: 400 },
    );
  }
  if (rawGuess < 0) {
    return NextResponse.json({ error: "Guess can't be negative." }, { status: 400 });
  }
  if (rawGuess > MAX_REASONABLE_GUESS) {
    return NextResponse.json(
      { error: `Enter a realistic guess (0–${MAX_REASONABLE_GUESS.toLocaleString()}).` },
      { status: 400 },
    );
  }

  const recorded = await store.recordCandyGuess({
    guestId,
    guestName: `${guest.firstName} ${guest.lastName}`,
    guess: rawGuess,
  });

  return NextResponse.json({ guess: recorded.guess });
}
