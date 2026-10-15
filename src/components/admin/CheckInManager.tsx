"use client";

import { useState } from "react";
import type { Guest } from "@/lib/data-access";

export interface PendingCheckIn {
  guest: Guest;
  /** The request's verification code (see pendingApprovalCode.ts) — the same one the requester's waiting screen shows. */
  code: string;
}

interface CheckInManagerProps {
  initialPending: PendingCheckIn[];
}

/**
 * Live, party-night tool for resolving guests stuck in "pending approval"
 * (see Guest.pendingApprovalAt) — a passkey registration with no phone on
 * file, or a "Check in with an admin" request. Each row shows the request's
 * verification code; approving asks the admin to confirm it matches the
 * code on the guest's own waiting screen. There's deliberately no "approve
 * all": every approval needs its own code check, or the code is pointless.
 * Meant to be usable one-handed on a phone at the door.
 */
export function CheckInManager({ initialPending }: CheckInManagerProps) {
  const [pending, setPending] = useState(initialPending);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function callAction(guestId: string, action: "approve" | "reject"): Promise<boolean> {
    const res = await fetch("/api/admin/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId, action }),
    });
    return res.ok;
  }

  async function handleApprove({ guest, code }: PendingCheckIn) {
    const name = `${guest.firstName} ${guest.lastName}`.trim();
    if (
      !window.confirm(
        `Does the code on ${name}'s waiting screen read ${code}?

Only approve if it matches exactly. Approving unlocks the device that filed this request.`,
      )
    ) {
      return;
    }
    setError(null);
    setBusyId(guest.id);
    try {
      const ok = await callAction(guest.id, "approve");
      if (!ok) throw new Error("Failed to approve.");
      setPending((prev) => prev.filter((p) => p.guest.id !== guest.id));
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
      setPending((prev) => prev.filter((p) => p.guest.id !== guest.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-400">{error}</p>}

      {pending.length === 0 ? (
        <p className="surface-panel rounded-lg p-4 text-center text-muted">
          No one is waiting on approval right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((entry) => {
            const { guest, code } = entry;
            const busy = busyId === guest.id;
            return (
              <li
                key={guest.id}
                className="surface-panel flex items-center justify-between gap-3 rounded-lg p-4"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-heading font-bold uppercase text-text">
                    {guest.firstName} {guest.lastName}
                  </span>
                  <span className="text-sm text-muted">
                    Code{" "}
                    <span
                      aria-label={`Check-in code ${code}`}
                      className="font-heading text-lg font-bold tracking-[0.2em] text-primary"
                    >
                      {code}
                    </span>
                  </span>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleApprove(entry)}
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
