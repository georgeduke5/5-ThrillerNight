import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getSiteConfig } from "@/lib/config";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { lastSelectionPerCategory } from "@/lib/voteSelections";
import { resetInProgressResponse } from "@/lib/resetInProgressResponse";
import { isValidId } from "@/lib/validation";

interface Selection {
  category: string;
  nomineeId: string;
}

/**
 * Admin-only "vote for this guest" (see GuestManager.tsx's "Vote for this
 * guest" action, and /admin/vote-as/[guestId]/page.tsx, which this backs):
 * lets an admin cast costume-contest votes under a TARGET guest's id, for a
 * guest having trouble logging in or voting themselves. Deliberately a
 * separate route from /api/votes rather than a mode of it — that route's
 * whole guarantee is "voterGuestId always comes from the session cookie,
 * never from anything client-supplied" (see its own doc comment), and this
 * route's entire point is to do the opposite, under a strictly admin-only
 * gate. Keeping them apart means that guarantee is still mechanically true
 * for every normal guest request; it was never weakened to make room for
 * this.
 *
 * isAdminRequest() is checked FIRST, before the id is even looked at —
 * every "could this id exist" question (malformed vs. well-formed-but-
 * missing) is answered identically (403) to a non-admin, so this never
 * becomes an oracle for enumerating real guest ids. This never creates,
 * reads, or touches the target guest's own session cookie (voterSession.ts
 * is not imported here at all) — the admin's own active session,
 * identity, and cookie are completely untouched by every call this route
 * handles; the only state this ever writes is a Votes row under the
 * target guest's id.
 */
function requireAdmin(): Promise<boolean> {
  return isAdminRequest();
}

/**
 * This guest's own current picks — the admin-only equivalent of GET
 * /api/votes, but by id instead of by session cookie, and always a fresh
 * (not 10s-cached) read: an admin about to cast a vote on this guest's
 * behalf needs their true current state, not a stale snapshot that could
 * silently overwrite a pick the guest themselves just made moments ago on
 * their own device.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ guestId: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { guestId } = await params;
  if (!isValidId(guestId)) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) {
    return NextResponse.json({ error: "Voting module is disabled." }, { status: 404 });
  }

  const store = getDataStore();
  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  const allVotes = await store.getVotes({ fresh: true });
  const votes = allVotes.filter((v) => v.voterGuestId === guestId);

  return NextResponse.json({ voterGuestId: guestId, votes });
}

/**
 * Casts (or overwrites) selections under the target guest's id — the
 * admin-only equivalent of POST /api/votes, with the exact same rules
 * (voting must be open, every category/nominee must exist and be eligible,
 * a repeat selection in the same category upserts rather than double-
 * counting — see DataStore.recordVote) and the same pending-approval check
 * (an admin voting on a guest's behalf doesn't bypass the separate
 * check-in-approval gate; it's enforced identically here). The one
 * difference from the guest-facing route: identity comes from the URL's
 * `guestId`, confirmed real and admin-authorized above, never from a
 * session cookie — this route never reads or writes the voter session
 * cookie at all, for the target guest or for the admin's own session.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ guestId: string }> }) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { guestId } = await params;
  if (!isValidId(guestId)) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) {
    return NextResponse.json({ error: "Voting module is disabled." }, { status: 404 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.isOpen) {
    return NextResponse.json({ error: "Voting is currently closed." }, { status: 403 });
  }

  const voter = await store.getGuestById(guestId);
  if (!voter) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }
  // Same gate POST /api/votes applies to the guest themselves — see that
  // route's own comment on Guest.pendingApprovalAt. An admin casting a
  // vote on this guest's behalf doesn't skip it.
  if (voter.pendingApprovalAt) {
    return NextResponse.json(
      { error: "This guest's check-in is still waiting on admin approval before they can vote." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => null)) as { selections?: Selection[] } | null;
  const selections = body?.selections;

  if (!Array.isArray(selections) || selections.length === 0) {
    return NextResponse.json({ error: "At least one selection is required." }, { status: 400 });
  }

  const [guests, groups] = await Promise.all([store.getGuests(), store.getGroups()]);
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

  // Same as POST /api/votes: one write per category, sequentially.
  const recorded = [];
  try {
    for (const s of lastSelectionPerCategory(selections)) {
      recorded.push(
        await store.recordVote({ voterGuestId: guestId, category: s.category, nomineeId: s.nomineeId }),
      );
    }
  } catch (err) {
    const res = resetInProgressResponse(err);
    if (res) return res;
    throw err;
  }

  return NextResponse.json({ votes: recorded });
}
