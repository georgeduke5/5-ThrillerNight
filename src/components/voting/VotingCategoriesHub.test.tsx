// @vitest-environment jsdom
/**
 * Isolated rendering tests for the "Voting Categories" hub: button labels,
 * config-driven order/count, the "Voted" badge, and the selection callback.
 * No fetch/data-access mocking needed — this component only renders props.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { VotingCategory } from "@/lib/config/types";
import { VotingCategoriesHub } from "./VotingCategoriesHub";

const CATEGORIES: VotingCategory[] = [
  { id: "best-adult-male-costume", label: "Best Adult Male Costume", bracket: "adult-male" },
  { id: "best-adult-female-costume", label: "Best Adult Female Costume", bracket: "adult-female" },
  { id: "best-boy-costume", label: "Best Boy Costume", bracket: "boy" },
  { id: "best-girl-costume", label: "Best Girl Costume", bracket: "girl" },
  { id: "best-group-costume", label: "Best Group Costume", bracket: null, nomineeType: "group" },
];

afterEach(() => {
  cleanup();
});

describe("VotingCategoriesHub", () => {
  it("is titled 'Voting Categories' and renders a 'Vote for [Category]' button for every category, config-driven order and count", () => {
    render(
      <VotingCategoriesHub categories={CATEGORIES} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />,
    );

    screen.getByRole("heading", { name: /voting categories/i });

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(CATEGORIES.length);
    CATEGORIES.forEach((category, i) => {
      expect(buttons[i]).toHaveTextContent(`Vote for ${category.label}`);
    });
  });

  it("renders correctly for a config with a different category count — nothing hardcoded to five", () => {
    const threeCategories = CATEGORIES.slice(0, 3);
    render(
      <VotingCategoriesHub categories={threeCategories} votedCategoryIds={new Set()} onSelectCategory={vi.fn()} />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("marks only voted categories with a 'Voted' badge, without hiding or disabling any button", () => {
    render(
      <VotingCategoriesHub
        categories={CATEGORIES}
        votedCategoryIds={new Set(["best-boy-costume", "best-group-costume"])}
        onSelectCategory={vi.fn()}
      />,
    );

    const votedButton = screen.getByRole("button", { name: /vote for best boy costume/i });
    expect(votedButton).toHaveTextContent(/voted/i);
    expect(votedButton).not.toBeDisabled();

    const notVotedButton = screen.getByRole("button", { name: /vote for best adult male costume/i });
    expect(notVotedButton).not.toHaveTextContent(/voted/i);
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
