// @vitest-environment jsdom
/**
 * The shared "results aren't published yet" screen used by both
 * /vote/results and /candy-count/results — covers that the percentage
 * renders at hero size as the dominant element (first in the DOM, far
 * larger font-size than everything else on the page) and that only the
 * caller-supplied text (percentCaption/subline) differs between callers,
 * never the layout/sizing. Visual parity between the two pages follows
 * structurally from both rendering this exact component.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UnpublishedResultsPage } from "./UnpublishedResultsPage";

afterEach(() => {
  cleanup();
});

describe("UnpublishedResultsPage", () => {
  it("renders the percentage, rounded to one decimal, as the first and by far the largest text on the page", () => {
    render(
      <UnpublishedResultsPage percent={8.84} percentCaption="of votes are in" subline="Check back soon." />,
    );

    const percentEl = screen.getByText("8.8%");
    const headingEl = screen.getByRole("heading", { name: /results aren.t published yet/i });

    // First in document order — the first thing a guest's eye lands on.
    expect(percentEl.compareDocumentPosition(headingEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Dominant: its own font-size utility class is dramatically larger
    // than the headline's — text-7xl (mobile) vs text-lg.
    expect(percentEl.className).toMatch(/text-7xl/);
    expect(headingEl.className).toMatch(/text-lg/);
    expect(headingEl.className).not.toMatch(/text-7xl|text-8xl|text-9xl/);
  });

  it("uses only the caller-supplied caption and subline — everything else is identical across callers", () => {
    render(
      <UnpublishedResultsPage percent={25} percentCaption="of guesses are in" subline="Check back once the hosts reveal the winner." />,
    );
    screen.getByText("of guesses are in");
    screen.getByText("Check back once the hosts reveal the winner.");
    expect(screen.queryByText("of votes are in")).not.toBeInTheDocument();
  });

  it("renders 0% without crashing when there are no eligible guests", () => {
    render(<UnpublishedResultsPage percent={0} percentCaption="of votes are in" subline="Check back soon." />);
    screen.getByText("0.0%");
  });

  it("includes a Home link", () => {
    render(<UnpublishedResultsPage percent={10} percentCaption="of votes are in" subline="Check back soon." />);
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
  });
});
