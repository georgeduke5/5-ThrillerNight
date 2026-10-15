"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { GuestBracket } from "@/lib/config/types";
import type { Guest } from "@/lib/data-access";
import { VerifyIdentityModal } from "@/components/voting/VerifyIdentityModal";
import { PhotoUploadButton } from "@/components/PhotoUploadButton";
import { PhotoCropModal } from "@/components/PhotoCropModal";

const BRACKET_OPTIONS: { value: GuestBracket; label: string }[] = [
  { value: "adult-male", label: "Adult Male" },
  { value: "adult-female", label: "Adult Female" },
  { value: "boy", label: "Boy" },
  { value: "girl", label: "Girl" },
];

/**
 * Self-service walk-in guest registration (requirements Section 5.2).
 *
 * Field layout/styling deliberately mirrors the admin Guests page's
 * add/edit modals (PhotoField-style photo picker, then First/Last/Phone/
 * Bracket) rather than this form's old plainer layout, so the two "create a
 * guest" surfaces feel like the same product.
 *
 * Creating the guest record is only half of "adding yourself" — it doesn't
 * establish a session, so without more this browser would land on /vote
 * still carrying whatever guest session (or none) it had before. Once the
 * guest is created, this hands off to VerifyIdentityModal via its
 * initialGuest prop: same verification flow (including the
 * zero-methods-enabled auto-check-in), same session-cookie issuance as
 * every other entry point into that flow — except the party-presence gate,
 * which initialGuest deliberately skips (see that prop's own doc comment) —
 * so /vote correctly recognizes the new guest rather than duplicating any
 * of that logic here.
 *
 * A photo can optionally be picked right here (cropped, then held as a
 * blob). It isn't uploaded until VerifyIdentityModal finishes verifying the
 * new guest — POST /api/photos requires a checked-in session, which a
 * freshly created guest record doesn't have yet — so it's handed to the
 * modal as initialPhoto, which uploads it in place of its own "Add a
 * costume photo?" prompt.
 */
export function WalkinForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [bracket, setBracket] = useState<GuestBracket | null>(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingPhotoBlob, setPendingPhotoBlob] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newGuest, setNewGuest] = useState<Guest | null>(null);

  function handlePhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingPhotoFile(file);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!bracket) {
      setError("Please choose one of the options above.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/guests/walkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, bracket, phone: phone.trim() || undefined }),
      });
      const body = (await res.json()) as { guest?: Guest; error?: string };
      if (!res.ok || !body.guest) throw new Error(body.error ?? "Failed to add you.");
      setNewGuest(body.guest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  function goToVote() {
    router.push("/vote");
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <PhotoUploadButton
          label="Add Costume Photo"
          onChange={handlePhotoFileChange}
          accept="image/*"
          disabled={submitting}
          className="self-start px-4 py-3"
        />
        <input
          required
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="field-input bg-surface px-4 py-3 text-text"
        />
        <input
          required
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="field-input bg-surface px-4 py-3 text-text"
        />
        <input
          type="tel"
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="field-input bg-surface px-4 py-3 text-text"
        />
        <div className="relative">
          <select
            required
            aria-label="Choose a category"
            value={bracket ?? ""}
            onChange={(e) => setBracket(e.target.value as GuestBracket)}
            className="w-full appearance-none rounded border border-muted bg-surface py-3 pl-4 pr-11 text-text"
          >
            <option value="" disabled>
              Choose a category
            </option>
            {BRACKET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
            className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        {error && <p className="text-base text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
        >
          {submitting ? "Adding…" : "Add Me"}
        </button>
      </form>

      {pendingPhotoFile && (
        <PhotoCropModal
          file={pendingPhotoFile}
          onCancel={() => setPendingPhotoFile(null)}
          onCropped={(blob) => {
            setPendingPhotoBlob(blob);
            setPendingPhotoFile(null);
          }}
        />
      )}

      {newGuest && (
        <VerifyIdentityModal
          guests={[newGuest]}
          initialGuest={newGuest}
          initialPhoto={pendingPhotoBlob}
          onVerified={goToVote}
          onCancel={goToVote}
        />
      )}
    </>
  );
}
