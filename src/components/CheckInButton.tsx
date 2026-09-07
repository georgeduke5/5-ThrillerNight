"use client";

import { useState } from "react";
import { VerifyIdentityModal } from "@/components/voting/VerifyIdentityModal";
import { useCheckedInGuest } from "@/hooks/useCheckedInGuest";

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
 * Check-in detection (is this browser already checked in, and as whom) is
 * shared with the home page's Vote button gate via useCheckedInGuest —
 * nobody with a valid session should ever have to tap through check-in
 * again just because they loaded this page.
 */
export function CheckInButton() {
  const { loaded, guests, activeGuest, setActiveGuestId } = useCheckedInGuest();
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setError(null);
    setShowModal(true);
  }

  function handleVerified(guestId: string) {
    setShowModal(false);
    setActiveGuestId(guestId);
  }

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
      {showModal && (
        <VerifyIdentityModal
          guests={guests}
          onVerified={handleVerified}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  );
}
