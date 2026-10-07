// @vitest-environment jsdom
/**
 * Isolated rendering tests for the "Voting Categories" hub: uniform static
 * (no animation) button sizing/numbering, "Best"-trimmed single-line
 * labels, the centered heading, the voted checkmark overlaid on a button's
 * own number (not a separate pill), and the selection callback. No
 * fetch/data-access mocking needed — this component only renders props.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VotingCategory } from "@/lib/config/types";
import { VotingCategoriesHub } from "./VotingCategoriesHub";

// Deliberately includes the longest realistic label (matching the actual
// site config's "Best Women's Costume") so the uniform-size/one-line
// guarantee is tested against its real worst case, not just short names.
const CATEGORIES: VotingCategory[] = [
  { id: "best-adult-male-costume", label: "Best Men's Costume", bracket: "adult-male" },
  { id: "best-adult-female-costume", label: "Best Women's Costume", bracket: "adult-female" },
  { id: "best-boy-costume", label: "Best Boy's Costume", bracket: "boy" },
  { id: "best-girl-costume", label: "Best Girl's Costume", bracket: "girl" },
  { id: "best-couple-group-costume", label: "Best Group Costume", bracket: null, nomineeType: "group" },
];

function hubButtons() {
  return screen.getAllByRole("button");
}

afterEach(() => {
  cleanup();
});

describe("VotingCategoriesHub", () => {
  it("is titled 'Voting Categories', centered, with one button per category showing the label with 'Best' dropped", () => {
    render(<VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />);

    const heading = screen.getByRole("heading", { name: /voting categories/i });
    expect(heading.className).toMatch(/text-center/);

    const buttons = hubButtons();
    expect(buttons).toHaveLength(CATEGORIES.length);
    CATEGORIES.forEach((category, i) => {
      const trimmed = category.label.replace(/^Best\s+/i, "");
      // Visible text has "Best " trimmed off the front...
      expect(buttons[i]).toHaveTextContent(trimmed);
      expect(buttons[i]).not.toHaveTextContent(/^best /i);
      // ...but the accessible name keeps the full configured label, for screen readers.
      expect(buttons[i]).toHaveAccessibleName(`Vote for ${category.label}`);
    });
  });

  it("shows each button's position (1-5) as a prominent number, matching the configured order", () => {
    render(<VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />);
    hubButtons().forEach((button, i) => {
      expect(button).toHaveTextContent(new RegExp(`^${i + 1}`));
    });
  });

  it("gives every button the same fixed height, tight static (no animation class) styling, and a single-line truncating label regardless of category name length", () => {
    render(<VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />);
    const buttons = hubButtons();
    buttons.forEach((button) => {
      // Same fixed-height utility class on every button, independent of label length...
      expect(button.className).toMatch(/\bh-16\b/);
      // ...and no leftover animated-glow class from the earlier design.
      expect(button.className).not.toMatch(/neon/);
    });
    // The longest label (the one that used to force a taller, two-line
    // button) is single-line/truncating, not wrapping.
    const longestLabel = screen.getByText("Women's Costume");
    expect(longestLabel.className).toMatch(/truncate/);
  });

  it("renders correctly for a config with a different category count — nothing hardcoded to five", () => {
    const threeCategories = CATEGORIES.slice(0, 3);
    render(
      <VotingCategoriesHub categories={threeCategories} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />,
    );
    const buttons = hubButtons();
    expect(buttons).toHaveLength(3);
    buttons.forEach((button, i) => expect(button).toHaveTextContent(new RegExp(`^${i + 1}`)));
  });

  it("shows a checkmark on a voted category's own number, with no separate 'Voted' pill, without hiding or disabling any button", () => {
    render(
      <VotingCategoriesHub
        categories={CATEGORIES}
        votedCategoryIds={new Set(["best-boy-costume", "best-couple-group-costume"])}
        onSelectCategory={vi.fn()}
      />,
    );

    const votedButton = screen.getByRole("button", { name: /vote for best boy's costume/i });
    expect(votedButton).toHaveTextContent("✓");
    expect(votedButton).toHaveAccessibleName(/already voted/i);
    expect(votedButton).not.toHaveTextContent(/voted/i); // the word "Voted" itself is gone — just the checkmark
    expect(votedButton).not.toBeDisabled();

    const notVotedButton = screen.getByRole("button", { name: /vote for best men's costume/i });
    expect(notVotedButton).not.toHaveTextContent("✓");
    expect(notVotedButton).not.toHaveAccessibleName(/already voted/i);
    expect(notVotedButton).not.toBeDisabled();
  });

  it("calls onSelectCategory with the tapped category's id", () => {
    const onSelectCategory = vi.fn();
    render(
      <VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={onSelectCategory} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /vote for best girl's costume/i }));
    expect(onSelectCategory).toHaveBeenCalledWith("best-girl-costume");
  });
});
