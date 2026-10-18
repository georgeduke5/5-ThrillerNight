// @vitest-environment jsdom
/**
 * "Reset to admins only" shows its step-by-step report, including when the
 * reset didn't finish, rather than a bare error.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DangerZoneAction } from "./DangerZoneAction";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const counts = { guests: 0, votes: 0, candyGuesses: 0, passkeys: 0, groupsDeleted: 0, groupsCleaned: 0 };

async function runReset(status: number, body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  render(
    <DangerZoneAction
      buttonLabel="Reset to Admins Only"
      heading="Reset to admins only?"
      description="…"
      endpoint="/api/admin/reset-to-admins-only"
      kind="reset-to-admins-only"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset to Admins Only" }));
  fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: "DELETE" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  return screen.findByRole("status");
}

describe("Reset to admins only result", () => {
  it("an unfinished reset lists what was deleted, what's still there, and which step failed", async () => {
    const status = await runReset(500, {
      ok: false,
      complete: false,
      error: "The reset didn't fully finish. Run it again to finish the rest.",
      steps: [
        { step: "Pause other changes", ok: true, detail: "On hold." },
        { step: "Delete guest data", ok: false, detail: "Stopped partway because Google Sheets returned an error." },
      ],
      wiped: { ...counts, photosDeleted: 0 },
      remaining: { ...counts, guests: 12, votes: 30 },
      photosNotDeleted: ["file-1"],
      adminsKept: ["George Duke"],
    });
    expect(status).toHaveTextContent("Run it again to finish the rest.");
    expect(status).toHaveTextContent("✗ Delete guest data");
    expect(status).toHaveTextContent("Still there: 12 guest(s), 30 vote(s)");
    expect(status).toHaveTextContent("Kept as admins: George Duke");
    expect(status).toHaveTextContent("file-1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a finished reset says so, with the counts", async () => {
    const status = await runReset(200, {
      ok: true,
      complete: true,
      steps: [{ step: "Delete guest data", ok: true, detail: "Everything except the admins is gone." }],
      wiped: { ...counts, guests: 30, photosDeleted: 25 },
      remaining: counts,
      photosNotDeleted: [],
      adminsKept: ["George Duke", "Sarah Duke"],
    });
    expect(status).toHaveTextContent("Reset complete");
    expect(status).toHaveTextContent("Deleted: 30 guest(s)");
    expect(status).toHaveTextContent("25 photo(s)");
    expect(status).not.toHaveTextContent("Still there");
  });
});
