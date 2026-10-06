// @vitest-environment jsdom
/**
 * Covers the admin Guests page's "Has passkey" indicator and the
 * "Remove Passkey" action: shown correctly per guest in both the list
 * view and the edit modal, the button only appears for a guest who
 * actually has one, a confirmation is required, and the indicator flips
 * to "No" immediately after a successful removal.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuestManager } from "./GuestManager";
import type { Guest } from "@/lib/data-access";

type AdminGuest = Guest & { hasPasskey: boolean };

function makeGuest(overrides: Partial<AdminGuest>): AdminGuest {
  return {
    id: "00000000-0000-0000-0000-00000000b1b1",
    firstName: "Gus",
    lastName: "Est",
    bracket: "adult-male",
    photoRef: null,
    photoUrl: null,
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    groupId: null,
    phone: null,
    checkedInAt: null,
    pendingApprovalAt: null,
    isAdmin: false,
    hasPasskey: false,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Has passkey indicator", () => {
  it("shows Yes/No correctly per guest in the list view", () => {
    const withPasskey = makeGuest({ id: "g1", firstName: "Hasit", lastName: "One", hasPasskey: true });
    const without = makeGuest({ id: "g2", firstName: "Hasit", lastName: "Not", hasPasskey: false });
    render(<GuestManager initialGuests={[withPasskey, without]} votedGuestIds={[]} placeholderImage="/placeholder.png" />);

    const rows = screen.getAllByRole("row");
    const withRow = rows.find((r) => r.textContent?.includes("Hasit One"));
    const withoutRow = rows.find((r) => r.textContent?.includes("Hasit Not"));
    expect(withRow).toHaveTextContent("Yes");
    expect(withoutRow).toHaveTextContent("No");
  });

  it("shows the indicator and a Remove Passkey button in the edit modal for a guest who has one", () => {
    const withPasskey = makeGuest({ id: "g1", firstName: "Hasit", lastName: "One", hasPasskey: true });
    render(<GuestManager initialGuests={[withPasskey]} votedGuestIds={[]} placeholderImage="/placeholder.png" />);

    fireEvent.click(screen.getByText("Hasit One"));
    expect(screen.getByText(/has passkey: yes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove passkey/i })).toBeInTheDocument();
  });

  it("shows no Remove Passkey button in the edit modal for a guest with none", () => {
    const without = makeGuest({ id: "g2", firstName: "Hasit", lastName: "Not", hasPasskey: false });
    render(<GuestManager initialGuests={[without]} votedGuestIds={[]} placeholderImage="/placeholder.png" />);

    fireEvent.click(screen.getByText("Hasit Not"));
    expect(screen.getByText(/has passkey: no/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove passkey/i })).not.toBeInTheDocument();
  });

  it("requires confirmation, calls DELETE /api/guests/[id]/passkey, and flips the indicator to No on success", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, removed: true }) }));
    vi.stubGlobal("fetch", fetchMock);

    const withPasskey = makeGuest({ id: "g1", firstName: "Hasit", lastName: "One", hasPasskey: true });
    render(<GuestManager initialGuests={[withPasskey]} votedGuestIds={[]} placeholderImage="/placeholder.png" />);

    fireEvent.click(screen.getByText("Hasit One"));
    fireEvent.click(screen.getByRole("button", { name: /remove passkey/i }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/guests/g1/passkey", { method: "DELETE" }));
    await waitFor(() => expect(screen.getByText(/has passkey: no/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /remove passkey/i })).not.toBeInTheDocument();
  });

  it("does nothing if the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const withPasskey = makeGuest({ id: "g1", firstName: "Hasit", lastName: "One", hasPasskey: true });
    render(<GuestManager initialGuests={[withPasskey]} votedGuestIds={[]} placeholderImage="/placeholder.png" />);

    fireEvent.click(screen.getByText("Hasit One"));
    fireEvent.click(screen.getByRole("button", { name: /remove passkey/i }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/has passkey: yes/i)).toBeInTheDocument();
  });
});
