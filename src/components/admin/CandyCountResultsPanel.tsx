"use client";

import { useState } from "react";
import type { CandyResults } from "@/lib/data-access/candyResults";

interface CandyCountResultsPanelProps {
  initialResults: CandyResults | null;
}

/**
 * Live guess standings with a manual refresh — mirrors LiveResultsPanel
 * (costume voting), rendered on /admin/candy-count alongside
 * CandyCountStatusToggles. `initialResults` is null whenever no true count
 * has been entered yet (nothing to rank against).
 */
export function CandyCountResultsPanel({ initialResults }: CandyCountResultsPanelProps) {
  const [results, setResults] = useState(initialResults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshResults() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/candy-count/results", { cache: "no-store" });
      const body = (await res.json()) as { results?: CandyResults | null; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load results.");
      setResults(body.results ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load results.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xl font-bold uppercase">Guesses &amp; Standings</h2>
        <button
          type="button"
          onClick={refreshResults}
          disabled={busy}
          className="text-sm text-primary underline disabled:opacity-60"
        >
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {!results ? (
        <p className="surface-panel rounded-lg p-4 text-sm text-muted">
          Enter the actual candy count above to see standings.
        </p>
      ) : results.ranked.length === 0 ? (
        <p className="surface-panel rounded-lg p-4 text-sm text-muted">No guesses yet.</p>
      ) : (
        <div className="surface-panel rounded-lg p-4">
          {results.winners.length > 1 && (
            <p className="mb-3 font-heading text-sm font-bold uppercase text-accent">
              Tie for closest — {results.winners.length} guesses, resolve live with
              rock-paper-scissors.
            </p>
          )}
          <ol className="flex flex-col gap-1">
            {results.ranked.map((r, idx) => {
              const isWinner = r.difference === results.winners[0]?.difference;
              return (
                <li
                  key={r.guestId}
                  className={`flex justify-between text-sm ${
                    isWinner ? "font-bold text-primary" : "text-text"
                  }`}
                >
                  <span>
                    {idx + 1}. {r.firstName} {r.lastName}
                  </span>
                  <span className="text-muted">
                    {r.guess} (off by {r.difference})
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}
