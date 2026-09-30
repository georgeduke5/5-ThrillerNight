import type { CandyGuess, Guest } from "./types";

export interface CandyGuessResult {
  guestId: string;
  firstName: string;
  lastName: string;
  guess: number;
  /** Math.abs(guess - trueCount). */
  difference: number;
}

export interface CandyResults {
  trueCount: number;
  /** Every guess, sorted closest-first (ties keep insertion order from the sheet). */
  ranked: CandyGuessResult[];
  /**
   * Every guess tied for closest — length 1 in the normal case, length 2+
   * when there's a tie to resolve live via rock-paper-scissors, empty only
   * when there are no guesses at all.
   */
  winners: CandyGuessResult[];
}

/**
 * Pure tallying logic, kept out of the DataStore interface since it's
 * derived data rather than a storage concern — mirrors
 * src/lib/data-access/results.ts's computeResults for costume voting.
 *
 * Resolves each guess's display name by joining against the live guest
 * list (guarding against a guest's name changing, or the guest being
 * deleted, after they guessed) rather than trusting the guess row's own
 * denormalized guestName, the same "join live data at read time" approach
 * computeResults already uses for nominee names.
 */
export function computeCandyResults(
  guesses: CandyGuess[],
  guests: Guest[],
  trueCount: number,
): CandyResults {
  const guestsById = new Map(guests.map((g) => [g.id, g]));

  const ranked: CandyGuessResult[] = guesses
    .map((g) => {
      const guest = guestsById.get(g.guestId);
      return {
        guestId: g.guestId,
        firstName: guest?.firstName ?? g.guestName.split(" ")[0] ?? g.guestName,
        lastName: guest ? guest.lastName : g.guestName.split(" ").slice(1).join(" "),
        guess: g.guess,
        difference: Math.abs(g.guess - trueCount),
      };
    })
    .sort((a, b) => a.difference - b.difference);

  const closest = ranked[0]?.difference;
  const winners = closest === undefined ? [] : ranked.filter((r) => r.difference === closest);

  return { trueCount, ranked, winners };
}
