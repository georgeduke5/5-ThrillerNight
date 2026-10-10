import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { getDataStore } from "@/lib/data-access";
import { computeResults } from "@/lib/data-access/results";
import { BackgroundPreload } from "@/components/BackgroundPreload";
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

  if (!status.resultsPublished) {
    // No turnout percentage on this page (the costume contest no longer
    // shows one — see UnpublishedResultsPage, still shared with
    // /candy-count/results, which keeps its own) — the "not published
    // yet" notice is the whole story here.
    return (
      <>
        <BackgroundPreload />
        <UnpublishedResultsPage
          title="Costume Contest"
          subline="Check back once the hosts reveal the winners."
        />
      </>
    );
  }

  const groups = await store.getGroups();
  const results = computeResults(guests, groups, votes, config.voting.categories);

  return (
    <main className="hero-background relative min-h-screen px-6 py-16">
      <BackgroundPreload />
      <HomeLink />
      <div className="fog-layer" />
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col gap-8">
        <ResultsHeader title="Costume Contest" />
        <h2 className="text-center font-heading text-4xl font-extrabold uppercase text-text">
          Winners
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {results.map((category) => {
            const winner = category.tallies[0];
            return (
              <div key={category.categoryId} className="surface-panel rounded-lg p-6 text-center">
                <p className="font-heading text-base uppercase tracking-wide text-muted">
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
      </div>
    </main>
  );
}
