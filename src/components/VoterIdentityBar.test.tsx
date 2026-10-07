// @vitest-environment jsdom
/**
 * The shared identity bar used by both VotingApp ("Voting as") and
 * CandyCountApp ("Guessing as") — covers that the label is config/caller
 * driven (not hardcoded to either page), the name/"Update my info" open
 * the same update-info callback, and "Not you?" opens the change-voter
 * callback. Visual parity between the two pages follows structurally from
 * both rendering this exact component — not re-tested per page here.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Guest } from "@/lib/data-access";
import { VoterIdentityBar } from "./VoterIdentityBar";

const GUEST: Guest = {
  id: "guest-1",
  firstName: "Gus",
  lastName: "Est",
  bracket: "adult-male",
  phone: null,
  photoRef: null,
  photoUrl: null,
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  checkedInAt: "2026-01-01T00:00:00.000Z",
  pendingApprovalAt: null,
  isAdmin: false,
};

afterEach(() => {
  cleanup();
});

describe("VoterIdentityBar", () => {
  it("renders the caller-supplied label and the voter's name", () => {
    render(
      <VoterIdentityBar label="Guessing as" voter={GUEST} onUpdateInfo={vi.fn()} onChangeVoter={vi.fn()} />,
    );
    screen.getByText(/guessing as/i);
    screen.getByRole("button", { name: "Gus Est" });
  });

  it("renders a different label for a different caller, same component", () => {
    render(
      <VoterIdentityBar label="Voting as" voter={GUEST} onUpdateInfo={vi.fn()} onChangeVoter={vi.fn()} />,
    );
    screen.getByText(/voting as/i);
    expect(screen.queryByText(/guessing as/i)).not.toBeInTheDocument();
  });

  it("calls onUpdateInfo when the name or 'Update my info' is clicked", () => {
    const onUpdateInfo = vi.fn();
    render(
      <VoterIdentityBar label="Voting as" voter={GUEST} onUpdateInfo={onUpdateInfo} onChangeVoter={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Gus Est" }));
    fireEvent.click(screen.getByRole("button", { name: /update my info/i }));
    expect(onUpdateInfo).toHaveBeenCalledTimes(2);
  });

  it("calls onChangeVoter when 'Not you?' is clicked", () => {
    const onChangeVoter = vi.fn();
    render(
      <VoterIdentityBar label="Voting as" voter={GUEST} onUpdateInfo={vi.fn()} onChangeVoter={onChangeVoter} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /not you\?/i }));
    expect(onChangeVoter).toHaveBeenCalledTimes(1);
  });
});
