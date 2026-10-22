import type { VotingCategory } from "@/lib/config/types";
import type { Group, Guest } from "@/lib/data-access/types";
import { isEligibleGroupNominee, isEligibleGuestNominee } from "@/lib/nomineeEligibility";

export interface VoteSelection {
  category: string;
  nomineeId: string;
}

/**
 * One selection per category, the last one wins — a ballot that names the
 * same category twice is treated as a change of mind, never as two votes.
 * Used by both vote-casting routes before anything is written.
 */
export function lastSelectionPerCategory<T extends VoteSelection>(selections: T[]): T[] {
  const byCategory = new Map<string, T>();
  for (const s of selections) {
    byCategory.delete(s.category); // keep insertion order = order of the final pick
    byCategory.set(s.category, s);
  }
  return Array.from(byCategory.values());
}

/**
 * Checks every selection on a ballot before anything is written, for both
 * vote-casting routes. Returns the first problem as a message for a 400,
 * or null when the whole ballot is valid: the category exists, the nominee
 * exists, a guest nominee is in the category's bracket, and the nominee is
 * currently eligible (checked in; for a group, at least one member checked
 * in; see nomineeEligibility.ts). Re-checked on every request, so a
 * crafted request can't vote for someone the galleries hide.
 */
export function findInvalidSelection(
  selections: Partial<VoteSelection>[],
  categories: VotingCategory[],
  guests: Guest[],
  groups: Group[],
): string | null {
  const guestsById = new Map(guests.map((g) => [g.id, g]));
  const groupsById = new Map(groups.map((g) => [g.id, g]));
  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  for (const selection of selections) {
    const category = categoriesById.get(selection?.category ?? "");
    if (!category) return `Unknown category: ${selection?.category}`;

    if ((category.nomineeType ?? "guest") === "group") {
      const group = groupsById.get(selection?.nomineeId ?? "");
      if (!group) return `Unknown nominee for category "${category.label}".`;
      if (!isEligibleGroupNominee(group, guestsById)) {
        return `${group.name} can't be voted for until one of its members has checked in.`;
      }
      continue;
    }

    const guest = guestsById.get(selection?.nomineeId ?? "");
    if (!guest) return `Unknown nominee for category "${category.label}".`;
    if (category.bracket !== null && guest.bracket !== category.bracket) {
      return `${guest.firstName} ${guest.lastName} isn't eligible for "${category.label}".`;
    }
    if (!isEligibleGuestNominee(guest)) {
      return `${guest.firstName} ${guest.lastName} can't be voted for until they've checked in.`;
    }
  }
  return null;
}
