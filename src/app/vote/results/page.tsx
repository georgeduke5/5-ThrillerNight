import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { getDataStore } from "@/lib/data-access";
import { computeResults } from "@/lib/data-access/results";

// Reads live Sheets data on every request — never statically prerendered,
// since results must reflect the current publish state and vote tallies.
export const dynamic = "force-dynamic";

/** Guest-facing results reveal — only renders real results once an admin has published them (Section 5.4). */
export default async function VoteResultsPage() {
  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) notFound();

  const store = getDataStore();
  const status = await store.getVotingStatus();

  if (!status.resultsPublished) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="font-heading text-3xl font-bold uppercase text-text">
          Results Aren&rsquo;t Published Yet
        </h1>
        <p className="text-muted">Check back once the hosts reveal the winners.</p>
      </main>
    );
  }

  const [guests, groups, votes] = await Promise.all([
    store.getGuests(),
    store.getGroups(),
    store.getVotes(),
  ]);
  const results = computeResults(guests, groups, votes, config.voting.categories);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <h1 className="text-center font-heading text-4xl font-extrabold uppercase text-text">
        Costume Contest Winners
      </h1>
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
