import { EventLogo } from "@/components/EventLogo";

interface ResultsHeaderProps {
  /** e.g. "Costume Contest" / "Candy Count" — matches the naming already used elsewhere on the site (the home page's own contest links). */
  title: string;
}

/**
 * Small logo + contest-name title shown at the top of both results pages
 * (/vote/results and /candy-count/results), in both their unpublished and
 * published states — see UnpublishedResultsPage (which renders this for
 * the unpublished state) and each results page's own published-view
 * markup (rendered directly there, since the published views aren't
 * otherwise shared between the two contests — there's no single layout
 * component covering both states/both pages to hang this off of instead).
 *
 * This is the page's actual `<h1>` — each results page's own existing
 * heading ("Winners", "Winner Coming Soon", "Results Aren't Published
 * Yet", etc.) is demoted to an `<h2>` (same visual size, just no longer
 * competing for the one-h1-per-page document outline, and deliberately
 * kept short/generic now that this header above it already states which
 * contest it's for).
 *
 * One consistent size in both states: on the unpublished view this reads
 * as the second-largest text on the page (well below the hero-sized
 * percentage, well above the small supporting lines); on the published
 * view, with no percentage to compete with, that same size already reads
 * as a clear, prominent page heading — no separate size variant needed.
 */
export function ResultsHeader({ title }: ResultsHeaderProps) {
  return (
    <header className="flex flex-col items-center gap-2">
      <EventLogo className="max-w-[9rem] sm:max-w-[12rem]" />
      <h1 className="font-heading text-3xl font-extrabold uppercase text-text sm:text-4xl">{title}</h1>
    </header>
  );
}
