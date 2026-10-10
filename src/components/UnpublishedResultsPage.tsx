import { HomeLink } from "@/components/HomeLink";
import { ResultsHeader } from "@/components/ResultsHeader";

interface UnpublishedResultsPageProps {
  /** e.g. "Costume Contest" / "Candy Count" — passed straight through to ResultsHeader. */
  title: string;
  /**
   * 0-100, already computed by the caller (submissions / total eligible
   * guests * 100). Optional — omit entirely (along with `percentCaption`)
   * for a contest that doesn't show this at all, e.g. the costume contest
   * page no longer tracks it. When omitted, no percentage renders and
   * nothing is reserved for it; the "not published yet" notice becomes
   * the hero element instead.
   */
  percent?: number;
  /** e.g. "of votes are in" / "of guesses are in" — required alongside `percent`, ignored if `percent` is omitted. */
  percentCaption?: string;
  /** e.g. "Check back once the hosts reveal the winners." / "...the winner." */
  subline: string;
}

/**
 * The "results aren't published yet" screen shared by /vote/results and
 * /candy-count/results — one component so the two contests' pre-publish
 * pages stay visually identical and a future style tweak (sizing, colors,
 * copy) only has to happen here. When `percent` is supplied it's the hero
 * element (requirements: the dominant, first-thing-the-eye-lands-on
 * element on the page), with the "not published yet" notice demoted to a
 * small supporting line beneath it; when it's omitted (the costume
 * contest page no longer passes it), the notice itself becomes the main
 * heading and the layout stays centered/balanced with one less element.
 * `title`/`percent`/`percentCaption`/`subline` are the only things that
 * differ between callers; everything else (layout, sizing, colors) is
 * identical by construction.
 */
export function UnpublishedResultsPage({ title, percent, percentCaption, subline }: UnpublishedResultsPageProps) {
  const hasPercent = percent !== undefined;
  return (
    <main className="hero-background relative flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <HomeLink />
      <div className="fog-layer" />
      <div className="relative z-10 mx-auto flex max-w-lg flex-col items-center gap-2">
        <ResultsHeader title={title} />
        {hasPercent && (
          <>
            <p className="mt-4 font-heading text-7xl font-black leading-none text-primary sm:text-8xl md:text-9xl">
              {percent.toFixed(1)}%
            </p>
            <p className="font-heading text-base uppercase tracking-wide text-muted">{percentCaption}</p>
          </>
        )}
        <h2 className={`font-heading text-lg font-bold uppercase text-text ${hasPercent ? "mt-6" : "mt-4"}`}>
          Results Aren&rsquo;t Published Yet
        </h2>
        <p className="text-base text-muted">{subline}</p>
      </div>
    </main>
  );
}
