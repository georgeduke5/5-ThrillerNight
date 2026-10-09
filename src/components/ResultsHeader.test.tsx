// @vitest-environment jsdom
/**
 * The small logo + contest-name header shared by both results pages'
 * unpublished and published states. Covers that it renders the logo, the
 * caller-supplied title as the page's <h1>, and that nothing is hardcoded
 * to either contest's name.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResultsHeader } from "./ResultsHeader";

afterEach(() => {
  cleanup();
});

describe("ResultsHeader", () => {
  it("renders the given title as an <h1>, plus the event logo", () => {
    render(<ResultsHeader title="Costume Contest" />);
    screen.getByRole("heading", { level: 1, name: "Costume Contest" });
    screen.getByRole("img", { name: /logo/i });
  });

  it("renders a different title for a different caller, same component", () => {
    render(<ResultsHeader title="Candy Count" />);
    screen.getByRole("heading", { level: 1, name: "Candy Count" });
    expect(screen.queryByText("Costume Contest")).not.toBeInTheDocument();
  });
});
