// @vitest-environment jsdom
/**
 * The shared "results aren't published yet" screen used by both
 * /vote/results and /candy-count/results — covers that the percentage
 * renders at hero size as the dominant element (first in the DOM, far
 * larger font-size than everything else on the page), that the
 * logo+title header (ResultsHeader) renders as the page's one <h1> sized
 * between the percentage and the smaller supporting text, and that only
 * the caller-supplied text (title/percentCaption/subline) differs between
 * callers, never the layout/sizing. Visual parity between the two pages
 * follows structurally from both rendering this exact component.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UnpublishedResultsPage } from "./UnpublishedResultsPage";

afterEach(() => {
  cleanup();
});

describe("UnpublishedResultsPage", () => {
  it("renders the percentage, rounded to one decimal, as the largest text on the page, after the title but before everything else", () => {
    render(
      <UnpublishedResultsPage
        title="Costume Contest"
        percent={8.84}
        percentCaption="of votes are in"
        subline="Check back soon."
      />,
    );

    const titleEl = screen.getByRole("heading", { level: 1, name: "Costume Contest" });
    const percentEl = screen.getByText("8.8%");
    const statusEl = screen.getByRole("heading", { level: 2, name: /results aren.t published yet/i });

    // Document order: title, then the hero percentage, then the smaller status line.
    expect(titleEl.compareDocumentPosition(percentEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(percentEl.compareDocumentPosition(statusEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Size hierarchy: percent (text-7xl) > title (text-3xl) > status line (text-lg).
    expect(percentEl.className).toMatch(/text-7xl/);
    expect(titleEl.className).toMatch(/text-3xl/);
    expect(titleEl.className).not.toMatch(/text-7xl|text-8xl|text-9xl/);
    expect(statusEl.className).toMatch(/text-lg/);
    expect(statusEl.className).not.toMatch(/text-3xl|text-7xl|text-8xl|text-9xl/);
  });

  it("uses only the caller-supplied title, caption, and subline — everything else is identical across callers", () => {
    render(
      <UnpublishedResultsPage
        title="Candy Count"
        percent={25}
        percentCaption="of guesses are in"
        subline="Check back once the hosts reveal the winner."
      />,
    );
    screen.getByRole("heading", { level: 1, name: "Candy Count" });
    screen.getByText("of guesses are in");
    screen.getByText("Check back once the hosts reveal the winner.");
    expect(screen.queryByText("of votes are in")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Costume Contest" })).not.toBeInTheDocument();
  });

  it("renders 0% without crashing when there are no eligible guests", () => {
    render(
      <UnpublishedResultsPage title="Costume Contest" percent={0} percentCaption="of votes are in" subline="Check back soon." />,
    );
    screen.getByText("0.0%");
  });

  it("includes a Home link (distinct from the logo's own back-to-home link)", () => {
    render(
      <UnpublishedResultsPage title="Costume Contest" percent={10} percentCaption="of votes are in" subline="Check back soon." />,
    );
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });
});
