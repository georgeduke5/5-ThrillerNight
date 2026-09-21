"use client";

import { useState } from "react";
import type { CategoryResults } from "@/lib/data-access/results";

interface LiveResultsPanelProps {
  initialResults: CategoryResults[];
}

/**
 * Live per-category vote tallies with a manual refresh. Rendered on
 * /admin/voting alongside VotingStatusToggles, which owns the separate
 * voting-status toggle switches.
 */
export function LiveResultsPanel({ initialResults }: LiveResultsPanelProps) {
  const [results, setResults] = useState(initialResults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshResults() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/votes/results", { cache: "no-store" });
      const body = (await res.json()) as { results?: CategoryResults[]; error?: string };
      if (!res.ok || !body.results) throw new Error(body.error ?? "Failed to load results.");
      setResults(body.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load results.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-xl font-bold uppercase">Live Results</h2>
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

      <div className="grid gap-4 sm:grid-cols-2">
        {results.map((category) => (
          <div key={category.categoryId} className="surface-panel rounded-lg p-4">
            <h3 className="mb-2 font-heading font-bold uppercase text-text">{category.label}</h3>
            {category.tallies.length === 0 ? (
              <p className="text-sm text-muted">No votes yet.</p>
            ) : (
              <ol className="flex flex-col gap-1">
                {category.tallies.map((t, idx) => (
                  <li key={t.nomineeId} className="flex justify-between text-sm text-text">
                    <span>
                      {idx + 1}. {t.firstName} {t.lastName}
                    </span>
                    <span className="text-muted">{t.voteCount}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
