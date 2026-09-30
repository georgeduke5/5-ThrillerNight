"use client";

import { useState } from "react";
import type { CandyCountStatus } from "@/lib/data-access";

/**
 * Shared candy-count-status read/update behavior — same
 * POST /api/admin/candy-count-status call, same busy/error handling — used
 * by CandyCountStatusToggles. Mirrors useVotingStatus.ts exactly, kept as a
 * separate hook (not a generic shared one) since the two features' status
 * shapes and endpoints are genuinely different and deliberately independent.
 */
export function useCandyCountStatus(initialStatus: CandyCountStatus) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(updates: Partial<CandyCountStatus>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/candy-count-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const body = (await res.json()) as CandyCountStatus & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to update candy count status.");
      setStatus(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update candy count status.");
    } finally {
      setBusy(false);
    }
  }

  return { status, busy, error, updateStatus };
}
