import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSiteConfig } from "@/lib/config";
import { getSessionGuestId } from "@/lib/auth/voterSession";

interface Selection {
  category: string;
  nomineeId: string;
}

/**
 * Returns the current session's identity (if any) plus that voter's own
 * previously cast votes (never anyone else's) — used to silently recognize
 * a returning voter on page load and pre-select their prior picks, without
 * requiring them to identify themselves or verify just to browse. Identity
 * comes solely from the session cookie (see voterSession.ts) — there's no
 * query param for this; a guest can't ask for someone else's votes by id.
 * No verification required to call this, same as browsing nominees
 * generally — only submitting a vote (POST below) is gated.
 */
export async function GET() {
  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) {
    return NextResponse.json({ error: "Voting module is disabled." }, { status: 404 });
  }

  const voterGuestId = await getSessionGuestId();
  if (!voterGuestId) {
    return NextResponse.json({ voterGuestId: null, votes: [] });
  }

  const allVotes = await getDataStore().getVotes();
  const votes = allVotes.filter((v) => v.voterGuestId === voterGuestId);

  return NextResponse.json({ voterGuestId, votes });
}

/**
 * Casts (or overwrites) the current session's selections. Identity-based,
 * not device-based, per requirements Section 5.2/8: a repeat submission
 * overwrites the prior pick in each category (DataStore.recordVote is an
 * upsert) rather than counting twice. Who's voting comes solely from the
 * verified session cookie (see voterSession.ts) — never from the request
 * body — so a guest can't cast a vote under another guest's identity by
 * searching or typing their name; there's no client-suppliable voterGuestId
 * at all. Browsing nominees is open, but this endpoint requires a valid
 * session, obtained via phone verification.
 */
export async function POST(request: NextRequest) {
  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) {
    return NextResponse.json({ error: "Voting module is disabled." }, { status: 404 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.isOpen) {
    return NextResponse.json({ error: "Voting is currently closed." }, { status: 403 });
  }

  const voterGuestId = await getSessionGuestId();
  if (!voterGuestId) {
    return NextResponse.json(
      { error: "Phone verification required.", requiresVerification: true },
      { status: 401 },
    );
  }

  const body = (await request.json().catch(() => null)) as { selections?: Selection[] } | null;
  const selections = body?.selections;

  if (!Array.isArray(selections) || selections.length === 0) {
    return NextResponse.json({ error: "At least one selection is required." }, { status: 400 });
  }

  const [voter, guests, groups] = await Promise.all([
    store.getGuestById(voterGuestId),
    store.getGuests(),
    store.getGroups(),
  ]);
  if (!voter) {
    // The session cookie is valid but the guest record it points to is
    // gone — treat as unverified rather than crashing.
    return NextResponse.json(
      { error: "Phone verification required.", requiresVerification: true },
      { status: 401 },
    );
  }

  const guestsById = new Map(guests.map((g) => [g.id, g]));
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const categoriesById = new Map(config.voting.categories.map((c) => [c.id, c]));

  for (const selection of selections) {
    const category = categoriesById.get(selection?.category);
    if (!category) {
      return NextResponse.json({ error: `Unknown category: ${selection?.category}` }, { status: 400 });
    }

    if ((category.nomineeType ?? "guest") === "group") {
      const nominee = groupsById.get(selection?.nomineeId);
      if (!nominee) {
        return NextResponse.json(
          { error: `Unknown nominee for category "${category.label}".` },
          { status: 400 },
        );
      }
      continue;
    }

    const nominee = guestsById.get(selection?.nomineeId);
    if (!nominee) {
      return NextResponse.json(
        { error: `Unknown nominee for category "${category.label}".` },
        { status: 400 },
      );
    }
    if (category.bracket !== null && nominee.bracket !== category.bracket) {
      return NextResponse.json(
        {
          error: `${nominee.firstName} ${nominee.lastName} isn't eligible for "${category.label}".`,
        },
        { status: 400 },
      );
    }
  }

  const recorded = await Promise.all(
    selections.map((s) => store.recordVote({ voterGuestId, category: s.category, nomineeId: s.nomineeId })),
  );

  return NextResponse.json({ votes: recorded });
}
