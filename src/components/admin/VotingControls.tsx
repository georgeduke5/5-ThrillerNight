"use client";

import { useState } from "react";
import type { VotingStatus } from "@/lib/data-access";
import type { CategoryResults } from "@/lib/data-access/results";

interface VotingControlsProps {
  initialStatus: VotingStatus;
  initialResults: CategoryResults[];
}

/**
 * Admin voting controls (requirements Section 5.4): the open/closed toggle
 * and publish-results action are separate — closing voting doesn't publish
 * results, and results stay visible to admins here regardless of publish
 * state.
 */
export function VotingControls({ initialStatus, initialResults }: VotingControlsProps) {
  const [status, setStatus] = useState(initialStatus);
  const [results, setResults] = useState(initialResults);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(updates: Partial<VotingStatus>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/voting-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const body = (await res.json()) as VotingStatus & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to update voting status.");
      setStatus(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update voting status.");
    } finally {
      setBusy(false);
    }
  }

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
    <div className="flex flex-col gap-6">
      <div className="surface-panel flex flex-wrap items-center gap-6 rounded-lg p-4">
        <div>
          <p className="text-sm text-muted">Voting status</p>
          <p className="font-heading text-lg font-bold uppercase">
            {status.isOpen ? "Open" : "Closed"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateStatus({ isOpen: !status.isOpen })}
          disabled={busy}
          className="rounded bg-primary px-4 py-2 font-heading font-bold uppercase text-bg disabled:opacity-60"
        >
          {status.isOpen ? "Close Voting" : "Open Voting"}
        </button>

        <div>
          <p className="text-sm text-muted">Results visibility</p>
          <p className="font-heading text-lg font-bold uppercase">
            {status.resultsPublished ? "Published" : "Private"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => updateStatus({ resultsPublished: !status.resultsPublished })}
          disabled={busy}
          className="rounded bg-accent px-4 py-2 font-heading font-bold uppercase text-bg disabled:opacity-60"
        >
          {status.resultsPublished ? "Unpublish Results" : "Publish Results"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

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
