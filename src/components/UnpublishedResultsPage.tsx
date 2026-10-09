import { HomeLink } from "@/components/HomeLink";
import { ResultsHeader } from "@/components/ResultsHeader";

interface UnpublishedResultsPageProps {
  /** e.g. "Costume Contest" / "Candy Count" — passed straight through to ResultsHeader. */
  title: string;
  /** 0-100, already computed by the caller (submissions / total eligible guests * 100). */
  percent: number;
  /** e.g. "of votes are in" / "of guesses are in" — the only wording that differs between callers. */
  percentCaption: string;
  /** e.g. "Check back once the hosts reveal the winners." / "...the winner." */
  subline: string;
}

/**
 * The "results aren't published yet" screen shared by /vote/results and
 * /candy-count/results — one component so the two contests' pre-publish
 * pages stay visually identical and a future style tweak (sizing, colors,
 * copy) only has to happen here. The submission percentage is the hero
 * element (requirements: the dominant, first-thing-the-eye-lands-on
 * element on the page), with the "not published yet" notice demoted to a
 * small supporting line beneath it — `title`/`percent`/`percentCaption`/
 * `subline` are the only things that differ between the two contests;
 * everything else (layout, sizing, colors) is identical by construction.
 */
export function UnpublishedResultsPage({ title, percent, percentCaption, subline }: UnpublishedResultsPageProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-2 px-6 text-center">
      <HomeLink />
      <ResultsHeader title={title} />
      <p className="mt-4 font-heading text-7xl font-black leading-none text-primary sm:text-8xl md:text-9xl">
        {percent.toFixed(1)}%
      </p>
      <p className="font-heading text-sm uppercase tracking-wide text-muted">{percentCaption}</p>
      <h2 className="mt-6 font-heading text-lg font-bold uppercase text-text">
        Results Aren&rsquo;t Published Yet
      </h2>
      <p className="text-sm text-muted">{subline}</p>
    </main>
  );
}
