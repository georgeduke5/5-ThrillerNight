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
 * six renders exactly that many buttons, unchanged.
 *
 * "Voted" is advisory only, never a gate: a category the voter has already
 * picked in is still just as tappable as one they haven't, since
 * DataStore.recordVote overwrites rather than blocking a repeat vote (see
 * VotingApp.castVote) — the guest can revisit and change any pick at any
 * time, in any order.
 */
export function VotingCategoriesHub({ categories, votedCategoryIds, onSelectCategory }: VotingCategoriesHubProps) {
  return (
    <section className="surface-panel rounded-lg p-4 shadow-lg shadow-primary/50">
      <h2 className="font-heading text-3xl font-bold uppercase text-text">Voting Categories</h2>
      <div className="mt-4 flex flex-col gap-3">
        {categories.map((category) => {
          const voted = votedCategoryIds.has(category.id);
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => onSelectCategory(category.id)}
              className="flex min-h-[56px] w-full items-center justify-between gap-3 rounded-lg bg-primary px-6 py-4 text-left font-heading text-xl font-bold uppercase text-bg shadow-lg transition-transform hover:scale-[1.02] focus-visible:outline focus-visible:outline-4 focus-visible:outline-white"
            >
              <span>Vote for {category.label}</span>
              {voted && (
                // Inverse of the button's own coloring (bg-primary/text-bg)
                // so the badge reads as a distinct status chip rather than
                // blending into the button it sits on.
                <span className="shrink-0 rounded-full bg-bg px-3 py-1 text-xs font-bold uppercase tracking-wide text-primary">
                  <span aria-hidden="true">✓</span> Voted
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
