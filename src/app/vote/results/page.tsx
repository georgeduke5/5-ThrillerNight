import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { getDataStore } from "@/lib/data-access";
import { computeResults } from "@/lib/data-access/results";
import { HomeLink } from "@/components/HomeLink";
import { UnpublishedResultsPage } from "@/components/UnpublishedResultsPage";
import { ResultsHeader } from "@/components/ResultsHeader";

// Reads live Sheets data on every request — never statically prerendered,
// since results must reflect the current publish state and vote tallies.
export const dynamic = "force-dynamic";

/** Guest-facing results reveal — only renders real results once an admin has published them (Section 5.4). */
export default async function VoteResultsPage() {
  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) notFound();

  const store = getDataStore();
  const [status, guests, votes] = await Promise.all([
    store.getVotingStatus(),
    store.getGuests(),
    store.getVotes(),
  ]);

  // Shown on this page regardless of publish state — "how much of the vote
  // is in" as of right now, distinct from the actual per-category results.
  const totalEligibleVoters = guests.length;
  const votersWhoVoted = new Set(votes.map((v) => v.voterGuestId)).size;
  const turnoutPercent =
    totalEligibleVoters > 0 ? (votersWhoVoted / totalEligibleVoters) * 100 : 0;
  const turnoutLabel = `${turnoutPercent.toFixed(1)}% of votes are in`;

  if (!status.resultsPublished) {
    // Turnout is the main event on this page while results are still
    // hidden (requirements: the percentage, not the "not published yet"
    // notice, is what a guest's eye should land on first) — see
    // UnpublishedResultsPage, shared with /candy-count/results so the two
    // contests' pre-publish pages stay visually identical.
    return (
      <UnpublishedResultsPage
        title="Costume Contest"
        percent={turnoutPercent}
        percentCaption="of votes are in"
        subline="Check back once the hosts reveal the winners."
      />
    );
  }

  const groups = await store.getGroups();
  const results = computeResults(guests, groups, votes, config.voting.categories);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <HomeLink />
      <ResultsHeader title="Costume Contest" />
      <h2 className="text-center font-heading text-4xl font-extrabold uppercase text-text">
        Costume Contest Winners
      </h2>
      <p className="text-center text-muted">{turnoutLabel}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {results.map((category) => {
          const winner = category.tallies[0];
          return (
            <div key={category.categoryId} className="surface-panel rounded-lg p-6 text-center">
              <p className="font-heading text-sm uppercase tracking-wide text-muted">
                {category.label}
              </p>
              {winner ? (
                <p className="mt-2 font-heading text-2xl font-bold text-primary">
                  {winner.firstName} {winner.lastName}
                </p>
              ) : (
                <p className="mt-2 text-muted">No votes cast.</p>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
