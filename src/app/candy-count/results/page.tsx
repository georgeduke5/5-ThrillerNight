import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { getDataStore } from "@/lib/data-access";
import { computeCandyResults } from "@/lib/data-access/candyResults";
import { HomeLink } from "@/components/HomeLink";
import { UnpublishedResultsPage } from "@/components/UnpublishedResultsPage";
import { ResultsHeader } from "@/components/ResultsHeader";

// Reads live Sheets data on every request — never statically prerendered,
// since results must reflect the current publish state and guess count.
export const dynamic = "force-dynamic";

/** Guest-facing results reveal — mirrors /vote/results: only renders real results once an admin has published them. */
export default async function CandyCountResultsPage() {
  const config = getSiteConfig();
  if (!config.features.candyCountModuleEnabled) notFound();

  const store = getDataStore();
  const [status, guesses, guests] = await Promise.all([
    store.getCandyCountStatus(),
    store.getCandyGuesses(),
    store.getGuests(),
  ]);

  if (!status.resultsPublished) {
    // Same "submissions / total eligible guests" percentage the voting
    // page's turnout uses (see /vote/results), deduped by guestId the same
    // way votes are — defensive here since recordCandyGuess already
    // upserts one guess per guest, but keeps this exactly consistent with
    // how the voting page computes its own percentage.
    const totalEligibleGuests = guests.length;
    const guestsWhoGuessed = new Set(guesses.map((g) => g.guestId)).size;
    const guessPercent = totalEligibleGuests > 0 ? (guestsWhoGuessed / totalEligibleGuests) * 100 : 0;

    return (
      <UnpublishedResultsPage
        title="Candy Count"
        percent={guessPercent}
        percentCaption="of guesses are in"
        subline="Check back once the hosts reveal the winner."
      />
    );
  }

  if (status.trueCount === null) {
    // Published with no true count entered yet — the admin panel warns
    // about this, but render gracefully rather than crashing if it happens.
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <HomeLink />
        <ResultsHeader title="Candy Count" />
        <h2 className="font-heading text-3xl font-bold uppercase text-text">Winner Coming Soon</h2>
        <p className="text-muted">The hosts haven&rsquo;t entered the actual count yet.</p>
      </main>
    );
  }

  const results = computeCandyResults(guesses, guests, status.trueCount);
  const soleWinner = results.winners.length === 1 ? results.winners[0] : undefined;

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <HomeLink />
      <ResultsHeader title="Candy Count" />
      <h2 className="text-center font-heading text-4xl font-extrabold uppercase text-text">
        Winners
      </h2>
      <p className="text-center text-muted">
        The jar actually had <span className="font-bold text-text">{status.trueCount}</span> pieces
        of candy.
      </p>

      <div className="surface-panel rounded-lg p-6 text-center">
        {results.winners.length === 0 ? (
          <p className="text-muted">No guesses were submitted.</p>
        ) : soleWinner ? (
          <>
            <p className="font-heading text-sm uppercase tracking-wide text-muted">Winner</p>
            <p className="mt-2 font-heading text-3xl font-bold text-primary">
              {soleWinner.firstName} {soleWinner.lastName}
            </p>
            <p className="mt-1 text-muted">
              Guessed {soleWinner.guess} — off by {soleWinner.difference}
            </p>
          </>
        ) : (
          <>
            <p className="font-heading text-sm uppercase tracking-wide text-muted">
              It&rsquo;s a tie! Resolved live with rock-paper-scissors.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {results.winners.map((w) => (
                <p key={w.guestId} className="font-heading text-2xl font-bold text-primary">
                  {w.firstName} {w.lastName}{" "}
                  <span className="text-base font-normal text-muted">(guessed {w.guess})</span>
                </p>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
