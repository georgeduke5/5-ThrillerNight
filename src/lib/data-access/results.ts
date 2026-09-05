import type { VotingCategory } from "@/lib/config/types";
import type { Group, Guest, Vote } from "./types";

export interface NomineeTally {
  nomineeId: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  voteCount: number;
}

export interface CategoryResults {
  categoryId: string;
  label: string;
  tallies: NomineeTally[];
}

/**
 * Pure tallying logic, kept out of the DataStore interface since it's
 * derived data rather than a storage concern — any backend's getGuests(),
 * getGroups(), and getVotes() are enough to compute it the same way.
 */
export function computeResults(
  guests: Guest[],
  groups: Group[],
  votes: Vote[],
  categories: VotingCategory[],
): CategoryResults[] {
  const guestsById = new Map(guests.map((g) => [g.id, g]));
  const groupsById = new Map(groups.map((g) => [g.id, g]));

  return categories.map((category) => {
    const isGroupCategory = (category.nomineeType ?? "guest") === "group";
    const counts = new Map<string, number>();
    for (const vote of votes) {
      if (vote.category !== category.id) continue;
      counts.set(vote.nomineeId, (counts.get(vote.nomineeId) ?? 0) + 1);
    }

    const tallies: NomineeTally[] = Array.from(counts.entries())
      .map(([nomineeId, voteCount]) => {
        if (isGroupCategory) {
          const group = groupsById.get(nomineeId);
          return {
            nomineeId,
            firstName: group?.name ?? "(removed group)",
            lastName: "",
            photoUrl: group?.photoUrl ?? null,
            voteCount,
          };
        }
        const guest = guestsById.get(nomineeId);
        return {
          nomineeId,
          firstName: guest?.firstName ?? "(removed guest)",
          lastName: guest?.lastName ?? "",
          photoUrl: guest?.photoUrl ?? null,
          voteCount,
        };
      })
      .sort((a, b) => b.voteCount - a.voteCount);

    return { categoryId: category.id, label: category.label, tallies };
  });
}
