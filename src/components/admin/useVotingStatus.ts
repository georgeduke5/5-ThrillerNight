"use client";

import { useState } from "react";
import type { VotingStatus } from "@/lib/data-access";

/**
 * Shared voting-status read/update behavior — same POST /api/admin/voting-status
 * call, same busy/error handling — used by both VotingStatusToggles (the
 * dashboard) and VotingControls (the /admin/voting results page), so a
 * change made from either place behaves identically even though each holds
 * its own independent copy of `status` (there's no cross-tab sync here,
 * same as before this was split into two call sites).
 */
export function useVotingStatus(initialStatus: VotingStatus) {
  const [status, setStatus] = useState(initialStatus);
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

  return { status, busy, error, updateStatus };
}
