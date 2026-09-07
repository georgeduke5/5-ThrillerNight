"use client";

import { useState } from "react";
import type { Guest } from "@/lib/data-access";
import type { GuestBracket } from "@/lib/config/types";
import { PhotoField } from "@/components/admin/PhotoField";

const BRACKET_OPTIONS: { value: GuestBracket; label: string }[] = [
  { value: "adult-male", label: "Adult Male" },
  { value: "adult-female", label: "Adult Female" },
  { value: "boy", label: "Boy" },
  { value: "girl", label: "Girl" },
];

export type GuestEdits = Partial<Pick<Guest, "firstName" | "lastName" | "bracket" | "phone">>;

interface GuestUpdateInfoModalProps {
  guest: Guest;
  placeholderImage: string;
  onSave: (updates: GuestEdits) => Promise<void>;
  onPhotoCropped: (blob: Blob) => Promise<void>;
  onClose: () => void;
}

/**
 * Guest-facing "update my info" screen — the same layout, components, and
 * styling as the admin GuestEditModal in GuestManager.tsx (same PhotoField,
 * same fields, same modal card), minus the delete button and the
 * admin-only "Source" field, which are admin concerns this screen has no
 * business exposing.
 *
 * Reachable from wherever a guest's own name is shown after they've
 * identified themselves — the "Voting as X" banner on /vote and the
 * "You're checked in as X" line on the home page — and from an explicit
 * "Update my info" link next to each. `guest` is always the caller's own
 * session-resolved identity (VotingApp's `voter`, useCheckedInGuest's
 * `activeGuest`), never a client-supplied id: saving goes through the same
 * PATCH /api/guests/[id] and POST /api/photos endpoints the admin version
 * uses, and the server itself enforces that a non-admin caller may only
 * patch their own id (see PATCH /api/guests/[id]).
 */
export function GuestUpdateInfoModal({
  guest,
  placeholderImage,
  onSave,
  onPhotoCropped,
  onClose,
}: GuestUpdateInfoModalProps) {
  const [firstName, setFirstName] = useState(guest.firstName);
  const [lastName, setLastName] = useState(guest.lastName);
  const [phone, setPhone] = useState(guest.phone ?? "");
  const [bracket, setBracket] = useState<GuestBracket>(guest.bracket);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    firstName !== guest.firstName ||
    lastName !== guest.lastName ||
    phone !== (guest.phone ?? "") ||
    bracket !== guest.bracket;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({ firstName, lastName, bracket, phone: phone.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoCropped(blob: Blob) {
    setError(null);
    try {
      await onPhotoCropped(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Update my info"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold uppercase text-text">
            {guest.firstName} {guest.lastName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-xl text-muted hover:text-text"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <PhotoField
            photoUrl={guest.photoUrl}
            alt={`${guest.firstName} ${guest.lastName}`}
            onCropped={handlePhotoCropped}
            placeholderImage={placeholderImage}
            size={72}
          />

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">First name</label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="field-input bg-bg px-3 py-2 text-lg text-text"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Last name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="field-input bg-bg px-3 py-2 text-lg text-text"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 555-5555"
                className="field-input bg-bg px-3 py-2 text-lg text-text"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Bracket</label>
              <select
                value={bracket}
                onChange={(e) => setBracket(e.target.value as GuestBracket)}
                className="rounded border border-muted bg-bg px-3 py-2 text-lg text-text"
              >
                {BRACKET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
