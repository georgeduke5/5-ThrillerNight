"use client";

import type { VotingCategory } from "@/lib/config/types";

interface VotingCategoriesHubProps {
  categories: VotingCategory[];
  /** Category ids the current voter already has a recorded pick for — drives the "Voted" badge only, never hides or disables a button. */
  votedCategoryIds: ReadonlySet<string>;
  onSelectCategory: (categoryId: string) => void;
}

/**
 * The top level of the two-level voting flow (requirements: a hub screen
 * listing every category, each leading to that category's own swipeable
 * nominee screen — see VotingApp's activeCategoryId state machine, which
 * this is purely presentational for). Category order and labels come
 * entirely from `categories` (config.voting.categories), same as every
 * other category-driven render in this app — nothing here is hardcoded to
 * a specific category count or name, so a config with four categories or
 * six renders exactly that many buttons, unchanged. The big number on each
 * button is purely `index + 1` within that same array — never a separate
 * config field — so it always matches the configured order.
 *
 * Every button is a fixed height (h-16) regardless of label length: the
 * label itself is `truncate`d (single line, ellipsis if it somehow still
 * doesn't fit) rather than allowed to wrap, which is what used to make
 * longer category names produce taller buttons and uneven spacing. A
 * same-height, always-present "badge slot" sits above every button (empty
 * when not voted) so the per-category "Voted" pill never changes any
 * button's position or the rhythm between them — see the comment on that
 * slot below.
 *
 * "Voted" is advisory only, never a gate: a category the voter has already
 * picked in is still just as tappable as one they haven't, since
 * DataStore.recordVote overwrites rather than blocking a repeat vote (see
 * VotingApp.castVote) — the guest can revisit and change any pick at any
 * time, in any order.
 *
 * The button's accessible name stays "Vote for {label}" via aria-label even
 * though the visible text is just the bare label (requirements: drop "Vote
 * for" from what's shown) — screen-reader users still get the actionable
 * phrasing, and it keeps this button's name distinguishable from the
 * category's own heading when it's later shown again on its own screen.
 */
export function VotingCategoriesHub({ categories, votedCategoryIds, onSelectCategory }: VotingCategoriesHubProps) {
  return (
    <section className="surface-panel rounded-lg p-4 shadow-lg shadow-primary/50">
      <h2 className="text-center font-heading text-3xl font-bold uppercase text-text">Voting Categories</h2>
      <div className="mt-6 flex flex-col gap-4">
        {categories.map((category, index) => {
          const voted = votedCategoryIds.has(category.id);
          return (
            <div key={category.id} className="flex flex-col items-center gap-1">
              {/* Fixed-height slot, present for every category whether or
                  not it's voted — keeps every button at the exact same
                  vertical position relative to its neighbors regardless of
                  voted status, instead of voted buttons being pushed down
                  by an extra inline badge. */}
              <div className="flex h-6 items-center justify-center">
                {voted && (
                  <span className="rounded-full bg-bg px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-primary shadow">
                    <span aria-hidden="true">✓</span> Voted
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onSelectCategory(category.id)}
                aria-label={`Vote for ${category.label}`}
                className="neon-button flex h-16 w-full items-center gap-3 rounded-lg bg-primary px-4 shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white"
              >
                <span
                  aria-hidden="true"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg font-heading text-lg font-extrabold text-primary"
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-left font-heading text-sm font-bold uppercase text-bg sm:text-base">
                  {category.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
