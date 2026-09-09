"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { Guest } from "@/lib/data-access";
import { VerifyIdentityModal } from "@/components/voting/VerifyIdentityModal";
import { GuestUpdateInfoModal, type GuestEdits } from "@/components/GuestUpdateInfoModal";

interface CheckInButtonProps {
  /** config.theme.placeholderImage — passed through to the "Update my info" screen's PhotoField. */
  placeholderImage: string;
  loaded: boolean;
  guests: Guest[];
  activeGuest: Guest | null;
  setActiveGuestId: (guestId: string | null) => void;
  setGuests: Dispatch<SetStateAction<Guest[]>>;
}

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
 * again just because they loaded this page. Once checked in, both the
 * guest's own name and an explicit "Update my info" link open the same
 * GuestUpdateInfoModal, operating on this browser's session-resolved
 * identity (activeGuest) — never a client-supplied id.
 */
export function CheckInButton({
  placeholderImage,
  loaded,
  guests,
  activeGuest,
  setActiveGuestId,
  setGuests,
}: CheckInButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [showUpdateInfo, setShowUpdateInfo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setError(null);
    setShowModal(true);
  }

  function handleVerified(guestId: string) {
    setShowModal(false);
    setActiveGuestId(guestId);
  }

  async function handleSaveInfo(id: string, updates: GuestEdits) {
    const res = await fetch(`/api/guests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const body = (await res.json().catch(() => null)) as { guest?: Guest; error?: string } | null;
    if (!res.ok || !body?.guest) throw new Error(body?.error ?? "Failed to update your info.");
    const savedGuest = body.guest;
    setGuests((prev) => prev.map((g) => (g.id === id ? savedGuest : g)));
  }

  async function handleSavePhoto(id: string, blob: Blob) {
    const formData = new FormData();
    formData.append("file", blob, "photo.jpg");
    formData.append("guestId", id);
    const res = await fetch("/api/photos", { method: "POST", body: formData });
    const body = (await res.json().catch(() => null)) as
      | { photoUrl?: string; photoRef?: string; error?: string }
      | null;
    if (!res.ok || !body?.photoUrl) throw new Error(body?.error ?? "Failed to upload photo.");
    setGuests((prev) =>
      prev.map((g) => (g.id === id ? { ...g, photoUrl: body.photoUrl as string, photoRef: body.photoRef ?? null } : g)),
    );
  }

  // Nothing to show until the session check resolves — avoids flashing
  // "Check In" for guests who are actually already checked in.
  if (!loaded) return null;

  return (
    <>
      {activeGuest ? (
        <div className="flex flex-col items-center gap-1">
          <p className="text-sm text-muted">You&rsquo;re checked in as</p>
          <button
            type="button"
            onClick={() => setShowUpdateInfo(true)}
            className="font-heading text-lg font-bold uppercase text-primary underline decoration-dotted underline-offset-4"
          >
            {activeGuest.firstName} {activeGuest.lastName}
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShowUpdateInfo(true)}
              className="text-sm text-muted underline hover:text-text"
            >
              Update my info
            </button>
            <button
              type="button"
              onClick={handleOpen}
              className="text-sm text-muted underline hover:text-text"
            >
              Not you?
            </button>
          </div>
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
      {showUpdateInfo && activeGuest && (
        <GuestUpdateInfoModal
          guest={activeGuest}
          placeholderImage={placeholderImage}
          onSave={(updates) => handleSaveInfo(activeGuest.id, updates)}
          onPhotoCropped={(blob) => handleSavePhoto(activeGuest.id, blob)}
          onClose={() => setShowUpdateInfo(false)}
        />
      )}
    </>
  );
}
