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

interface PhotoUploadResult {
  photoUrl: string;
  photoRef: string;
}

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
 * initialGuest prop: same phone/code (or admin skip-verify) verification,
 * same session-cookie issuance as every other entry point into that flow,
 * so /vote correctly recognizes the new guest rather than duplicating any
 * of that logic here.
 *
 * A photo can now optionally be picked right here (cropped, then held as a
 * blob and uploaded once the guest record exists — same "hold until the id
 * exists" pattern as the admin add flow in GuestManager). That photoUrl
 * ends up on `newGuest` before VerifyIdentityModal ever mounts, so its own
 * optional "Add a costume photo?" step — which only shows for a guest with
 * no photoUrl yet (see completeVerification there) — correctly skips itself
 * instead of asking again for a photo this guest already provided.
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

  async function uploadPhoto(guestId: string, blob: Blob): Promise<PhotoUploadResult | null> {
    const formData = new FormData();
    formData.append("file", blob, "photo.jpg");
    formData.append("guestId", guestId);
    const res = await fetch("/api/photos", { method: "POST", body: formData });
    const body = (await res.json().catch(() => null)) as
      | { photoUrl?: string; photoRef?: string; error?: string }
      | null;
    if (!res.ok || !body?.photoUrl) {
      setError(body?.error ?? "Added, but the photo failed to upload.");
      return null;
    }
    return { photoUrl: body.photoUrl, photoRef: body.photoRef ?? "" };
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
      let guest = body.guest;

      if (pendingPhotoBlob) {
        const uploaded = await uploadPhoto(guest.id, pendingPhotoBlob);
        if (uploaded) guest = { ...guest, photoUrl: uploaded.photoUrl, photoRef: uploaded.photoRef };
      }

      setNewGuest(guest);
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
        <select
          required
          aria-label="Which are you?"
          value={bracket ?? ""}
          onChange={(e) => setBracket(e.target.value as GuestBracket)}
          className="rounded border border-muted bg-surface px-4 py-3 text-text"
        >
          <option value="" disabled>
            Which are you?
          </option>
          {BRACKET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && <p className="text-sm text-red-400">{error}</p>}
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
          onVerified={goToVote}
          onCancel={goToVote}
        />
      )}
    </>
  );
}
