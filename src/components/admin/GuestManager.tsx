"use client";

import { useMemo, useState, type FormEvent } from "react";
import Image from "next/image";
import type { Guest } from "@/lib/data-access";
import type { GuestBracket } from "@/lib/config/types";
import { PhotoField } from "./PhotoField";

type GuestEdits = Partial<Pick<Guest, "firstName" | "lastName" | "bracket" | "phone">>;

const BRACKET_OPTIONS: { value: GuestBracket; label: string }[] = [
  { value: "adult-male", label: "Adult Male" },
  { value: "adult-female", label: "Adult Female" },
  { value: "boy", label: "Boy" },
  { value: "girl", label: "Girl" },
];

const SOURCE_LABELS: Record<Guest["source"], string> = {
  manual: "Manually added",
  "evite-import": "Imported (Evite)",
  "walk-in": "Walk-in",
  rsvp: "RSVP",
};

interface GuestManagerProps {
  initialGuests: Guest[];
  /** Guest ids with at least one cast vote (requirements: pulled from votes data, unique voter identities). */
  votedGuestIds: string[];
  /** config.theme.placeholderImage — shown for any guest with no photo uploaded, in every view below. */
  placeholderImage: string;
}

type View = "list" | "grid";

interface PhotoUploadResult {
  photoUrl: string;
  photoRef: string;
}

/**
 * Unified Guests admin page (replaces the old separate Guests + Photos
 * pages): manual add, a list/grid view toggle, and a full-record edit modal
 * (name, phone, bracket, photo) opened by clicking any guest in either
 * view. All reads/writes still go through the API routes, which themselves
 * go through DataStore — nothing here talks to Sheets/Drive directly.
 */
export function GuestManager({ initialGuests, votedGuestIds, placeholderImage }: GuestManagerProps) {
  const [guests, setGuests] = useState(initialGuests);
  const votedSet = useMemo(() => new Set(votedGuestIds), [votedGuestIds]);
  const sortedGuests = useMemo(
    () =>
      [...guests].sort((a, b) =>
        a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" }),
      ),
    [guests],
  );

  const [view, setView] = useState<View>("list");
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bracket, setBracket] = useState<GuestBracket>("adult-male");
  const [phone, setPhone] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const editingGuest = guests.find((g) => g.id === editingGuestId) ?? null;

  async function uploadGuestPhoto(guestId: string, blob: Blob): Promise<PhotoUploadResult | null> {
    const formData = new FormData();
    formData.append("file", blob, "photo.jpg");
    formData.append("guestId", guestId);
    const res = await fetch("/api/photos", { method: "POST", body: formData });
    const body = (await res.json().catch(() => null)) as
      | { photoUrl?: string; photoRef?: string; error?: string }
      | null;
    if (!res.ok || !body?.photoUrl) {
      setError(body?.error ?? "Saved, but the photo failed to upload.");
      return null;
    }
    return { photoUrl: body.photoUrl, photoRef: body.photoRef ?? "" };
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, bracket, phone: phone.trim() || undefined }),
      });
      const body = (await res.json()) as { guest?: Guest; error?: string };
      if (!res.ok || !body.guest) throw new Error(body.error ?? "Failed to add guest.");
      let guest = body.guest;

      // The guest needs an id before a photo can be attached, so a photo
      // picked in the add form is held as a blob and only uploaded once the
      // guest record itself exists — from the admin's perspective it's still
      // one "add guest with photo" action.
      if (pendingPhoto) {
        const uploaded = await uploadGuestPhoto(guest.id, pendingPhoto);
        if (uploaded) guest = { ...guest, photoUrl: uploaded.photoUrl, photoRef: uploaded.photoRef };
      }

      setGuests((prev) => [...prev, guest]);
      setFirstName("");
      setLastName("");
      setPhone("");
      setPendingPhoto(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add guest.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(id: string, updates: GuestEdits) {
    const res = await fetch(`/api/guests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const body = (await res.json()) as { guest?: Guest; error?: string };
    if (!res.ok || !body.guest) throw new Error(body.error ?? "Failed to update guest.");
    setGuests((prev) => prev.map((g) => (g.id === id ? (body.guest as Guest) : g)));
  }

  async function handleEditPhotoCropped(guestId: string, blob: Blob) {
    const uploaded = await uploadGuestPhoto(guestId, blob);
    if (uploaded) {
      setGuests((prev) =>
        prev.map((g) =>
          g.id === guestId ? { ...g, photoUrl: uploaded.photoUrl, photoRef: uploaded.photoRef } : g,
        ),
      );
    }
  }

  async function handleDelete(guest: Guest) {
    if (
      !window.confirm(
        `Delete ${guest.firstName} ${guest.lastName}? This also removes every vote they cast and every vote cast for them. This can't be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/guests/${guest.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to delete guest.");
      }
      setGuests((prev) => prev.filter((g) => g.id !== guest.id));
      setEditingGuestId((current) => (current === guest.id ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete guest.");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleAdd} className="surface-panel flex flex-col gap-3 rounded-lg p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="text-xs text-muted">First name</label>
            <input
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="field-input bg-bg px-3 py-2 text-text"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted">Last name</label>
            <input
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="field-input bg-bg px-3 py-2 text-text"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted">Phone (optional)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className="field-input bg-bg px-3 py-2 text-text"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted">Bracket</label>
            <select
              value={bracket}
              onChange={(e) => setBracket(e.target.value as GuestBracket)}
              className="rounded border border-muted bg-bg px-3 py-2 text-text"
            >
              {BRACKET_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-primary px-4 py-2 font-heading font-bold uppercase text-bg disabled:opacity-60"
          >
            Add Guest
          </button>
        </div>

        <PhotoField
          photoUrl={null}
          alt="New guest photo preview"
          onCropped={(blob) => setPendingPhoto(blob)}
          placeholderImage={placeholderImage}
          size={56}
        />
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <ViewToggleButton active={view === "list"} onClick={() => setView("list")}>
          List
        </ViewToggleButton>
        <ViewToggleButton active={view === "grid"} onClick={() => setView("grid")}>
          Photo Grid
        </ViewToggleButton>
      </div>

      {view === "list" ? (
        <GuestListView
          guests={sortedGuests}
          votedSet={votedSet}
          onSelect={setEditingGuestId}
          placeholderImage={placeholderImage}
        />
      ) : (
        <GuestGridView
          guests={sortedGuests}
          votedSet={votedSet}
          onSelect={setEditingGuestId}
          placeholderImage={placeholderImage}
        />
      )}

      {editingGuest && (
        <GuestEditModal
          guest={editingGuest}
          status={guestStatus(editingGuest, votedSet.has(editingGuest.id))}
          onSave={(updates) => handleUpdate(editingGuest.id, updates)}
          onPhotoCropped={(blob) => handleEditPhotoCropped(editingGuest.id, blob)}
          onDelete={() => handleDelete(editingGuest)}
          onClose={() => setEditingGuestId(null)}
          placeholderImage={placeholderImage}
        />
      )}
    </div>
  );
}

function ViewToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-4 py-2 font-heading text-sm font-bold uppercase ${
        active ? "bg-primary text-bg" : "surface-panel text-text"
      }`}
    >
      {children}
    </button>
  );
}

type GuestStatus = "not-checked-in" | "checked-in" | "voted";

/** Voted implies checked-in (casting a vote requires a verified session), so this order is a strict hierarchy. */
function guestStatus(guest: Guest, voted: boolean): GuestStatus {
  if (voted) return "voted";
  if (guest.checkedInAt) return "checked-in";
  return "not-checked-in";
}

function GuestStatusBadge({ status }: { status: GuestStatus }) {
  if (status === "voted") {
    return (
      <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold uppercase text-bg">
        Voted
      </span>
    );
  }
  if (status === "checked-in") {
    return (
      <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold uppercase text-bg">
        Checked In
      </span>
    );
  }
  return (
    <span className="rounded-full border border-muted/40 px-2 py-0.5 text-xs uppercase text-muted">
      Not Checked In
    </span>
  );
}

function GuestListView({
  guests,
  votedSet,
  onSelect,
  placeholderImage,
}: {
  guests: Guest[];
  votedSet: Set<string>;
  onSelect: (id: string) => void;
  placeholderImage: string;
}) {
  return (
    <div className="surface-panel overflow-x-auto rounded-lg">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-bg text-muted">
            <th className="px-4 py-2">Photo</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((guest) => {
            const status = guestStatus(guest, votedSet.has(guest.id));
            return (
              <tr
                key={guest.id}
                onClick={() => onSelect(guest.id)}
                className="cursor-pointer border-b border-bg/50 hover:bg-bg/40"
              >
                <td className="px-4 py-2">
                  {/* ring-* is a box-shadow, not a border — it doesn't add to the
                      element's box size, so this never changes row height/alignment
                      regardless of status. */}
                  <div
                    className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-bg ${
                      status !== "not-checked-in" ? "ring-4 ring-primary" : ""
                    }`}
                  >
                    <Image
                      src={guest.photoUrl ?? placeholderImage}
                      alt={`${guest.firstName} ${guest.lastName}`}
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  </div>
                </td>
                <td className="px-4 py-2 text-text">
                  {guest.firstName} {guest.lastName}
                </td>
                <td className="px-4 py-2">
                  <GuestStatusBadge status={status} />
                </td>
              </tr>
            );
          })}
          {guests.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-muted">
                No guests yet. Add one above or use the CSV importer.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function GuestGridView({
  guests,
  votedSet,
  onSelect,
  placeholderImage,
}: {
  guests: Guest[];
  votedSet: Set<string>;
  onSelect: (id: string) => void;
  placeholderImage: string;
}) {
  if (guests.length === 0) {
    return <p className="text-muted">No guests yet. Add one above or use the CSV importer.</p>;
  }
  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
      {guests.map((guest) => {
        const status = guestStatus(guest, votedSet.has(guest.id));
        return (
          <button
            key={guest.id}
            type="button"
            onClick={() => onSelect(guest.id)}
            className="surface-panel flex flex-col items-center gap-1 rounded-lg p-2 text-center"
          >
            {/* ring-* is a box-shadow, not a border — it doesn't add to the
                element's box size, so this never changes grid cell size or
                alignment regardless of status. */}
            <div
              className={`relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-bg ${
                status !== "not-checked-in" ? "ring-4 ring-primary" : ""
              }`}
            >
              <Image
                src={guest.photoUrl ?? placeholderImage}
                alt={`${guest.firstName} ${guest.lastName}`}
                width={80}
                height={80}
                className="h-full w-full object-cover"
                unoptimized
              />
              {status === "voted" && (
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-sm font-bold text-white"
                >
                  ✓
                </span>
              )}
            </div>
            <p className="text-xs text-text">
              {guest.firstName} {guest.lastName}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function GuestEditModal({
  guest,
  status,
  onSave,
  onPhotoCropped,
  onDelete,
  onClose,
  placeholderImage,
}: {
  guest: Guest;
  status: GuestStatus;
  onSave: (updates: GuestEdits) => Promise<void>;
  onPhotoCropped: (blob: Blob) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
  placeholderImage: string;
}) {
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
      aria-label={`Edit ${guest.firstName} ${guest.lastName}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold uppercase text-text">
            {guest.firstName} {guest.lastName}
          </h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onDelete}
              aria-label={`Delete ${guest.firstName} ${guest.lastName}`}
              title="Delete guest"
              className="text-lg text-muted hover:text-red-400"
            >
              🗑️
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="text-xl text-muted hover:text-text">
              ×
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <GuestStatusBadge status={status} />
          </div>

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
                className="field-input bg-bg px-3 py-2 text-text"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Last name</label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="field-input bg-bg px-3 py-2 text-text"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Phone</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 555-5555"
                className="field-input bg-bg px-3 py-2 text-text"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Bracket</label>
              <select
                value={bracket}
                onChange={(e) => setBracket(e.target.value as GuestBracket)}
                className="rounded border border-muted bg-bg px-3 py-2 text-text"
              >
                {BRACKET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Source</label>
              <p className="rounded border border-transparent bg-bg px-3 py-2 text-muted">
                {SOURCE_LABELS[guest.source]}
              </p>
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
