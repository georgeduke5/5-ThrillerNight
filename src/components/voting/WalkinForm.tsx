"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { GuestBracket } from "@/lib/config/types";
import type { Guest } from "@/lib/data-access";
import { VerifyIdentityModal } from "@/components/voting/VerifyIdentityModal";

const BRACKET_OPTIONS: { value: GuestBracket; label: string }[] = [
  { value: "adult-male", label: "Adult Male" },
  { value: "adult-female", label: "Adult Female" },
  { value: "boy", label: "Boy" },
  { value: "girl", label: "Girl" },
];

/**
 * Self-service walk-in guest registration (requirements Section 5.2).
 *
 * Creating the guest record is only half of "adding yourself" — it doesn't
 * establish a session, so without more this browser would land on /vote
 * still carrying whatever guest session (or none) it had before. Once the
 * guest is created, this hands off to VerifyIdentityModal via its
 * initialGuest prop: same phone/code (or admin skip-verify) verification,
 * same optional photo-capture step, same session-cookie issuance as every
 * other entry point into that flow, so /vote correctly recognizes the new
 * guest rather than duplicating any of that logic here.
 */
export function WalkinForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bracket, setBracket] = useState<GuestBracket | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newGuest, setNewGuest] = useState<Guest | null>(null);

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
        body: JSON.stringify({ firstName, lastName, bracket }),
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
        <fieldset className="flex flex-col gap-2 text-text">
          <legend className="mb-1 text-sm text-muted">Which are you? (required)</legend>
          {BRACKET_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2">
              <input
                required
                type="radio"
                name="bracket"
                checked={bracket === option.value}
                onChange={() => setBracket(option.value)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
        >
          {submitting ? "Adding…" : "Add Me"}
        </button>
      </form>

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
