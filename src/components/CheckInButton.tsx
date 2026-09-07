"use client";

import { useEffect, useState } from "react";
import type { Guest } from "@/lib/data-access";
import { VerifyIdentityModal } from "@/components/voting/VerifyIdentityModal";

/**
 * "Check In" — a dedicated entry point into the same phone-verification
 * flow voting uses (VerifyIdentityModal, unchanged), triggered on arrival
 * rather than at vote time. Verifying here establishes the same session
 * cookie voting checks, so a guest who checks in first won't be prompted
 * again when they later cast a vote. The per-vote prompt still exists
 * separately and still works standalone (e.g. a parent re-verifying on the
 * same device to vote on behalf of a child) — this button doesn't replace
 * it, just offers an earlier, optional way to complete the same step.
 *
 * On mount, this checks whether the browser already has an active session
 * (GET /api/votes, the same session-derived identity the voting page uses)
 * — if so, it skips the "Check In" button entirely and shows who's already
 * checked in, with a "Not you?" link to switch. Nobody with a valid session
 * should ever have to tap through check-in again just because they loaded
 * this page.
 */
export function CheckInButton() {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [sessionGuestId, setSessionGuestId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [guestsRes, votesRes] = await Promise.all([
          fetch("/api/guests", { cache: "no-store" }),
          fetch("/api/votes", { cache: "no-store" }),
        ]);
        const guestsBody = (await guestsRes.json().catch(() => null)) as { guests?: Guest[] } | null;
        const votesBody = (await votesRes.json().catch(() => null)) as { voterGuestId?: string | null } | null;
        if (cancelled) return;
        setGuests(guestsBody?.guests ?? []);
        setSessionGuestId(votesBody?.voterGuestId ?? null);
      } catch {
        // Leave unidentified — the "Check In" button below still works standalone.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleOpen() {
    setError(null);
    setShowModal(true);
  }

  function handleVerified(guestId: string) {
    setShowModal(false);
    setSessionGuestId(guestId);
  }

  const activeGuest = guests?.find((g) => g.id === sessionGuestId) ?? null;

  // Nothing to show until the session check resolves — avoids flashing
  // "Check In" for guests who are actually already checked in.
  if (!loaded) return null;

  return (
    <>
      {activeGuest ? (
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm text-muted">You&rsquo;re checked in as</p>
          <p className="font-heading text-lg font-bold uppercase text-primary">
            {activeGuest.firstName} {activeGuest.lastName}
          </p>
          <button
            type="button"
            onClick={handleOpen}
            className="text-sm text-muted underline hover:text-text"
          >
            Not you?
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className="inline-block rounded-md bg-accent px-8 py-4 text-center font-heading text-xl font-bold uppercase tracking-wide text-bg shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-4 focus-visible:outline-white sm:text-2xl"
        >
          Check In
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {showModal && guests && (
        <VerifyIdentityModal
          guests={guests}
          onVerified={handleVerified}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  );
}
