"use client";

import { useState, type FormEvent } from "react";
import type { Guest } from "@/lib/data-access";
import type { GuestBracket } from "@/lib/config/types";

type GuestEdits = Partial<Pick<Guest, "firstName" | "lastName" | "bracket">>;

const BRACKET_OPTIONS: { value: GuestBracket; label: string }[] = [
  { value: "adult-male", label: "Adult Male" },
  { value: "adult-female", label: "Adult Female" },
  { value: "boy", label: "Boy" },
  { value: "girl", label: "Girl" },
];

interface GuestManagerProps {
  initialGuests: Guest[];
}

/** Manual guest entry + editing (requirements Section 5.1/5.4). */
export function GuestManager({ initialGuests }: GuestManagerProps) {
  const [guests, setGuests] = useState(initialGuests);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bracket, setBracket] = useState<GuestBracket>("adult-male");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, bracket }),
      });
      const body = (await res.json()) as { guest?: Guest; error?: string };
      if (!res.ok || !body.guest) throw new Error(body.error ?? "Failed to add guest.");
      setGuests((prev) => [...prev, body.guest as Guest]);
      setFirstName("");
      setLastName("");
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

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={handleAdd} className="surface-panel flex flex-wrap items-end gap-3 rounded-lg p-4">
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
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="surface-panel overflow-x-auto rounded-lg">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-bg text-muted">
              <th className="px-4 py-2">First</th>
              <th className="px-4 py-2">Last</th>
              <th className="px-4 py-2">Bracket</th>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Photo</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {guests.map((guest) => (
              <GuestRow key={guest.id} guest={guest} onUpdate={handleUpdate} />
            ))}
            {guests.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  No guests yet. Add one above or use the CSV importer.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GuestRow({
  guest,
  onUpdate,
}: {
  guest: Guest;
  onUpdate: (id: string, updates: GuestEdits) => Promise<void>;
}) {
  const [firstName, setFirstName] = useState(guest.firstName);
  const [lastName, setLastName] = useState(guest.lastName);
  const [bracket, setBracket] = useState<GuestBracket>(guest.bracket);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    firstName !== guest.firstName || lastName !== guest.lastName || bracket !== guest.bracket;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onUpdate(guest.id, { firstName, lastName, bracket });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b border-bg/50">
      <td className="px-4 py-2">
        <input
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="w-28 rounded border border-transparent bg-transparent px-1 focus:border-muted focus:bg-bg"
        />
      </td>
      <td className="px-4 py-2">
        <input
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="w-28 rounded border border-transparent bg-transparent px-1 focus:border-muted focus:bg-bg"
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={bracket}
          onChange={(e) => setBracket(e.target.value as GuestBracket)}
          className="rounded border border-transparent bg-transparent px-1 focus:border-muted focus:bg-bg"
        >
          {BRACKET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2 text-muted">{guest.source}</td>
      <td className="px-4 py-2">{guest.photoUrl ? "✅" : "—"}</td>
      <td className="px-4 py-2">
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-primary px-2 py-1 text-xs font-bold uppercase text-bg"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  );
}
