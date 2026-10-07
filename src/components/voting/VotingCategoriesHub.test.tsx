// @vitest-environment jsdom
/**
 * Isolated rendering tests for the "Voting Categories" hub: uniform button
 * sizing/numbering, bare labels (no "Vote for" prefix) with a one-line
 * guarantee, the centered heading, the "Voted" badge's new position
 * outside the button, and the selection callback. No fetch/data-access
 * mocking needed — this component only renders props.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VotingCategory } from "@/lib/config/types";
import { VotingCategoriesHub } from "./VotingCategoriesHub";

// Deliberately includes the longest realistic label (matching the actual
// site config's "Best Couple/Group Costume") so the uniform-size/one-line
// guarantee is tested against its real worst case, not just short names.
const CATEGORIES: VotingCategory[] = [
  { id: "best-adult-male-costume", label: "Best Adult Male Costume", bracket: "adult-male" },
  { id: "best-adult-female-costume", label: "Best Adult Female Costume", bracket: "adult-female" },
  { id: "best-boy-costume", label: "Best Boy Costume", bracket: "boy" },
  { id: "best-girl-costume", label: "Best Girl Costume", bracket: "girl" },
  { id: "best-couple-group-costume", label: "Best Couple/Group Costume", bracket: null, nomineeType: "group" },
];

function hubButtons() {
  return screen.getAllByRole("button");
}

afterEach(() => {
  cleanup();
});

describe("VotingCategoriesHub", () => {
  it("is titled 'Voting Categories', centered, with one button per category showing just the bare label (no 'Vote for' prefix)", () => {
    render(<VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />);

    const heading = screen.getByRole("heading", { name: /voting categories/i });
    expect(heading.className).toMatch(/text-center/);

    const buttons = hubButtons();
    expect(buttons).toHaveLength(CATEGORIES.length);
    CATEGORIES.forEach((category, i) => {
      // Visible text is the bare label — "Vote for" is gone from what's shown...
      expect(buttons[i]).toHaveTextContent(category.label);
      expect(buttons[i]).not.toHaveTextContent(/vote for/i);
      // ...but the accessible name still reads as an action, for screen readers.
      expect(buttons[i]).toHaveAccessibleName(`Vote for ${category.label}`);
    });
  });

  it("shows each button's position (1-5) as a prominent number, matching the configured order", () => {
    render(<VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />);
    hubButtons().forEach((button, i) => {
      expect(button).toHaveTextContent(new RegExp(`^${i + 1}`));
    });
  });

  it("gives every button the same fixed height and single-line truncating label, regardless of category name length", () => {
    render(<VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />);
    const buttons = hubButtons();
    // Same fixed-height utility class on every button, independent of label length...
    buttons.forEach((button) => expect(button.className).toMatch(/\bh-16\b/));
    // ...and the longest label (the one that used to force a taller,
    // two-line button) is single-line/truncating, not wrapping.
    const longestLabel = screen.getByText("Best Couple/Group Costume");
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

  it("marks only voted categories with a 'Voted' badge positioned outside the button itself, without hiding or disabling any button", () => {
    render(
      <VotingCategoriesHub
        categories={CATEGORIES}
        votedCategoryIds={new Set(["best-boy-costume", "best-couple-group-costume"])}
        onSelectCategory={vi.fn()}
      />,
    );

    const votedButton = screen.getByRole("button", { name: /vote for best boy costume/i });
    // The badge sits next to, not inside, the button.
    expect(votedButton).not.toHaveTextContent(/voted/i);
    expect(votedButton).not.toBeDisabled();
    // ...but it's right there in the same group, directly above the button.
    expect(votedButton.closest("div")).toHaveTextContent(/voted/i);

    const notVotedButton = screen.getByRole("button", { name: /vote for best adult male costume/i });
    expect(notVotedButton.closest("div")).not.toHaveTextContent(/voted/i);
    expect(notVotedButton).not.toBeDisabled();
  });

  it("calls onSelectCategory with the tapped category's id", () => {
    const onSelectCategory = vi.fn();
    render(
      <VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={onSelectCategory} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /vote for best girl costume/i }));
    expect(onSelectCategory).toHaveBeenCalledWith("best-girl-costume");
  });
});
