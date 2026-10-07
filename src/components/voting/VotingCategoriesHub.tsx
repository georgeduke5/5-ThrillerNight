"use client";

import type { VotingCategory } from "@/lib/config/types";

interface VotingCategoriesHubProps {
  categories: VotingCategory[];
  /** Category ids the current voter already has a recorded pick for — drives the checkmark on a button's number only, never hides or disables the button. */
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
 * longer category names produce taller buttons and uneven spacing. The
 * visible label drops a leading "Best " (displayLabel below) — purely a
 * display trim done here, not a mutation of `category.label` itself, so
 * every other consumer of the config (the category's own screen, the
 * admin results page, etc.) still sees/shows the full configured name.
 *
 * "Voted" is advisory only, never a gate: a category the voter has already
 * picked in is still just as tappable as one they haven't, since
 * DataStore.recordVote overwrites rather than blocking a repeat vote (see
 * VotingApp.castVote) — the guest can revisit and change any pick at any
 * time, in any order. It's shown as a small checkmark badge overlaid on
 * the button's own number (not a separate pill), so a voted button takes
 * up exactly the same space as one that isn't — every button therefore
 * stays the same size and evenly spaced regardless of vote status, not
 * just regardless of label length.
 *
 * The button's accessible name stays "Vote for {label}" (full label, not
 * the trimmed display one) via aria-label even though the visible text is
 * shorter — screen-reader users still get the full, actionable phrasing,
 * and it also announces the voted state, which the checkmark badge (itself
 * aria-hidden, being purely decorative over the number) otherwise wouldn't.
 */
export function VotingCategoriesHub({ categories, votedCategoryIds, onSelectCategory }: VotingCategoriesHubProps) {
  return (
    <section className="surface-panel rounded-lg p-4 shadow-lg shadow-primary/50">
      <h2 className="text-center font-heading text-3xl font-bold uppercase text-text">Voting Categories</h2>
      <div className="mt-4 flex flex-col gap-2">
        {categories.map((category, index) => {
          const voted = votedCategoryIds.has(category.id);
          const displayLabel = category.label.replace(/^Best\s+/i, "");
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onSelectCategory(category.id)}
              aria-label={voted ? `Vote for ${category.label} (already voted)` : `Vote for ${category.label}`}
              className="flex h-16 w-full items-center gap-2 rounded-lg bg-primary px-3 shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white"
            >
              <span
                aria-hidden="true"
                className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-bg font-heading text-2xl font-black text-primary"
              >
                {index + 1}
                {voted && (
                  <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-xs font-black text-bg ring-2 ring-bg">
                    ✓
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-left font-heading text-base font-extrabold uppercase text-bg sm:text-lg">
                {displayLabel}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
