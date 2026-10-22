import type { Group, Guest } from "@/lib/data-access/types";
import { hasFullCheckInAccess } from "@/lib/auth/guestStatus";

/**
 * Who can be a costume-contest nominee: the one rule shared by the nominee
 * lists (GET /api/votes/nominees, which the voting galleries filter by),
 * both vote-casting routes, and the results tallies (computeResults).
 *
 * A guest is eligible only while fully checked in (checkedInAt set and not
 * pending; see hasFullCheckInAccess). Imported guests who haven't checked
 * in, pending guests, and rejected guests are all out. It's re-derived from
 * the current guest records every time, so a guest who drops back to
 * pending stops counting until they're checked in again.
 *
 * A group is eligible while at least one of its members is. This only
 * decides who's eligible; the category brackets are applied separately,
 * exactly as before.
 */
export function isEligibleGuestNominee(guest: Pick<Guest, "checkedInAt" | "pendingApprovalAt">): boolean {
  return hasFullCheckInAccess(guest);
}

export function isEligibleGroupNominee(
  group: Pick<Group, "memberIds">,
  guestsById: ReadonlyMap<string, Pick<Guest, "checkedInAt" | "pendingApprovalAt">>,
): boolean {
  return group.memberIds.some((id) => {
    const member = guestsById.get(id);
    return !!member && isEligibleGuestNominee(member);
  });
}

export interface EligibleNominees {
  guestIds: Set<string>;
  groupIds: Set<string>;
}

export function getEligibleNominees(guests: Guest[], groups: Group[]): EligibleNominees {
  const guestsById = new Map(guests.map((g) => [g.id, g]));
  return {
    guestIds: new Set(guests.filter(isEligibleGuestNominee).map((g) => g.id)),
    groupIds: new Set(groups.filter((g) => isEligibleGroupNominee(g, guestsById)).map((g) => g.id)),
  };
}
