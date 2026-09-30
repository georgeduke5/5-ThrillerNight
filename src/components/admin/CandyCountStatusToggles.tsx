"use client";

import { useState, type FormEvent } from "react";
import type { CandyCountStatus } from "@/lib/data-access";
import { useCandyCountStatus } from "./useCandyCountStatus";
import { ToggleRow } from "./ToggleRow";

interface CandyCountStatusTogglesProps {
  initialStatus: CandyCountStatus;
}

/**
 * Candy Count contest admin controls — "Guessing Status" and "Results
 * Visibility" toggles (same Sheets-backed on/off pattern as
 * VotingStatusToggles), plus the true-count entry field that drives winner
 * calculation. Deliberately its own component on its own admin page, not
 * folded into VotingStatusToggles/the voting admin page — this is a
 * separate contest with separate state.
 */
export function CandyCountStatusToggles({ initialStatus }: CandyCountStatusTogglesProps) {
  const { status, busy, error, updateStatus } = useCandyCountStatus(initialStatus);
  const [trueCountInput, setTrueCountInput] = useState(
    status.trueCount !== null ? String(status.trueCount) : "",
  );
  const [trueCountError, setTrueCountError] = useState<string | null>(null);

  async function handleSaveTrueCount(event: FormEvent) {
    event.preventDefault();
    setTrueCountError(null);
    const trimmed = trueCountInput.trim();
    if (trimmed === "") {
      // Clearing the field is allowed — reverts to "not yet entered,"
      // e.g. to correct a mistaken entry before anyone's seen it.
      await updateStatus({ trueCount: null });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setTrueCountError("Enter a non-negative whole number.");
      return;
    }
    await updateStatus({ trueCount: parsed });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ToggleRow
          label="Guessing Status"
          on={status.guessingOpen}
          onLabel="Open"
          offLabel="Closed"
          onToggle={() => updateStatus({ guessingOpen: !status.guessingOpen })}
          disabled={busy}
        />
        <ToggleRow
          label="Results Visibility"
          on={status.resultsPublished}
          onLabel="Published"
          offLabel="Unpublished"
          onToggle={() => updateStatus({ resultsPublished: !status.resultsPublished })}
          disabled={busy}
        />
      </div>

      <form
        onSubmit={handleSaveTrueCount}
        className="surface-panel flex flex-col gap-3 rounded-lg p-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="candy-true-count" className="font-heading font-bold uppercase text-text">
            Actual Candy Count
          </label>
          <p className="text-sm text-muted">
            {status.trueCount !== null
              ? "Closest guess(es) are calculated automatically below once this is set."
              : "Enter the real count once it's known to calculate the winner."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="candy-true-count"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={trueCountInput}
            onChange={(e) => setTrueCountInput(e.target.value)}
            placeholder="e.g. 214"
            className="field-input w-32 bg-bg px-4 py-2 text-text"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-primary px-4 py-2 font-heading font-bold uppercase text-bg disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </form>

      {trueCountError && <p className="text-sm text-red-400">{trueCountError}</p>}

      {status.resultsPublished && status.trueCount === null && (
        <p className="text-sm text-accent">
          Results are published, but no true count has been entered yet — guests will see an
          empty results page until you enter one.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
