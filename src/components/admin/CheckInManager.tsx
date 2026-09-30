"use client";

import { useState } from "react";
import type { Guest } from "@/lib/data-access";

interface CheckInManagerProps {
  initialPendingGuests: Guest[];
}

/**
 * Live, party-night tool for resolving guests stuck in "pending approval"
 * (see Guest.pendingApprovalAt) — a first-time passkey registration that
 * completed without phone verification because no phone was on file.
 * Deliberately minimal: one list, two buttons per row, one bulk action —
 * meant to be usable one-handed on a phone at the door.
 */
export function CheckInManager({ initialPendingGuests }: CheckInManagerProps) {
  const [pending, setPending] = useState(initialPendingGuests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function callAction(guestId: string, action: "approve" | "reject"): Promise<boolean> {
    const res = await fetch("/api/admin/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId, action }),
    });
    return res.ok;
  }

  async function handleApprove(guest: Guest) {
    setError(null);
    setBusyId(guest.id);
    try {
      const ok = await callAction(guest.id, "approve");
      if (!ok) throw new Error("Failed to approve.");
      setPending((prev) => prev.filter((g) => g.id !== guest.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(guest: Guest) {
    const name = `${guest.firstName} ${guest.lastName}`.trim();
    if (
      !window.confirm(
        `Clear ${name}'s passkey registration? This resets their identity to zero so the real guest can register from scratch. This can't be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusyId(guest.id);
    try {
      const ok = await callAction(guest.id, "reject");
      if (!ok) throw new Error("Failed to reject.");
      setPending((prev) => prev.filter((g) => g.id !== guest.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleApproveAll() {
    if (pending.length === 0) return;
    setError(null);
    setBulkBusy(true);
    try {
      const results = await Promise.all(
        pending.map(async (g) => ({ guestId: g.id, ok: await callAction(g.id, "approve") })),
      );
      const approvedIds = new Set(results.filter((r) => r.ok).map((r) => r.guestId));
      setPending((prev) => prev.filter((g) => !approvedIds.has(g.id)));
      if (approvedIds.size < results.length) {
        setError("Some guests couldn't be approved. Please try again.");
      }
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      {pending.length > 0 && (
        <button
          type="button"
          onClick={handleApproveAll}
          disabled={bulkBusy || busyId !== null}
          className="rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
        >
          {bulkBusy ? "Approving…" : `Approve All Pending (${pending.length})`}
        </button>
      )}

      {pending.length === 0 ? (
        <p className="surface-panel rounded-lg p-4 text-center text-muted">
          No one is waiting on approval right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((guest) => {
            const busy = bulkBusy || busyId === guest.id;
            return (
              <li
                key={guest.id}
                className="surface-panel flex items-center justify-between gap-3 rounded-lg p-4"
              >
                <span className="min-w-0 truncate font-heading font-bold uppercase text-text">
                  {guest.firstName} {guest.lastName}
                </span>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleApprove(guest)}
                    disabled={busy}
                    className="rounded bg-primary px-3 py-2 text-sm font-heading font-bold uppercase text-bg disabled:opacity-60"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(guest)}
                    disabled={busy}
                    className="rounded border border-red-400/60 px-3 py-2 text-sm font-heading font-bold uppercase text-red-400 disabled:opacity-60"
                  >
                    Reject
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
