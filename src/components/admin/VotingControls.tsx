"use client";

import { useState } from "react";
import Link from "next/link";
import type { VotingStatus } from "@/lib/data-access";
import type { CategoryResults } from "@/lib/data-access/results";
import { useVotingStatus } from "./useVotingStatus";

interface VotingControlsProps {
  initialStatus: VotingStatus;
  initialResults: CategoryResults[];
}

/**
 * Turnout stats + live results for admins. The interactive open/closed,
 * results-publish, phone-verification, and self-service walk-in switches
 * used to live here as buttons — they've moved to the dashboard
 * (VotingStatusToggles) so an admin never has to click through to see or
 * change them. This page keeps a read-only summary of that same status
 * (via the shared useVotingStatus hook, initialized from the same
 * server-fetched status) alongside the two warning messages, since they're
 * still useful context while looking at turnout/results — just no longer
 * editable from here.
 */
export function VotingControls({ initialStatus, initialResults }: VotingControlsProps) {
  const { status } = useVotingStatus(initialStatus);
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
    <div className="flex flex-col gap-6">
      <div className="surface-panel flex flex-wrap items-center gap-6 rounded-lg p-4">
        <div>
          <p className="text-sm text-muted">Voting status</p>
          <p className="font-heading text-lg font-bold uppercase">
            {status.isOpen ? "Open" : "Closed"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted">Results visibility</p>
          <p className="font-heading text-lg font-bold uppercase">
            {status.resultsPublished ? "Published" : "Private"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted">Phone Verification</p>
          <p className="font-heading text-lg font-bold uppercase">
            {status.phoneVerificationEnabled ? "On" : "Off"}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted">Self-Service Walk-In</p>
          <p className="font-heading text-lg font-bold uppercase">
            {status.selfServiceWalkinEnabled ? "On" : "Off"}
          </p>
        </div>
        <Link href="/admin" className="ml-auto text-sm text-primary underline">
          Manage on dashboard →
        </Link>
      </div>

      {!status.phoneVerificationEnabled && (
        <p className="text-sm text-accent">
          Phone verification is off — guests can check in and vote without a real SMS code.
        </p>
      )}

      {!status.selfServiceWalkinEnabled && (
        <p className="text-sm text-accent">
          Self-service walk-in is off — /vote/walkin is disabled and its link no longer appears
          when a guest can&rsquo;t find their name.
        </p>
      )}

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
