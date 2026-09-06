"use client";

import { useState } from "react";
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
 */
export function CheckInButton() {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [checkedIn, setCheckedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setError(null);
    setShowModal(true);
    if (guests) return;
    try {
      const res = await fetch("/api/guests", { cache: "no-store" });
      const body = (await res.json()) as { guests?: Guest[]; error?: string };
      if (!res.ok || !body.guests) throw new Error(body.error ?? "Failed to load the guest list.");
      setGuests(body.guests);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the guest list.");
      setShowModal(false);
    }
  }

  function handleVerified() {
    setShowModal(false);
    setCheckedIn(true);
  }

  if (checkedIn) {
    return (
      <p className="font-heading text-lg font-bold uppercase text-primary">You&rsquo;re checked in! ✓</p>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-block rounded-md bg-accent px-8 py-4 text-center font-heading text-xl font-bold uppercase tracking-wide text-bg shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-4 focus-visible:outline-white sm:text-2xl"
      >
        Check In
      </button>
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
