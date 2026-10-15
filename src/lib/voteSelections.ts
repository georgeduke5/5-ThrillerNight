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
