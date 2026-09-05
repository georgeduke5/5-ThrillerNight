"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { GuestBracket } from "@/lib/config/types";
import type { Guest } from "@/lib/data-access";

const BRACKET_OPTIONS: { value: GuestBracket; label: string }[] = [
  { value: "adult-male", label: "Adult Male" },
  { value: "adult-female", label: "Adult Female" },
  { value: "boy", label: "Boy" },
  { value: "girl", label: "Girl" },
];

/** Self-service walk-in guest registration (requirements Section 5.2). */
export function WalkinForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bracket, setBracket] = useState<GuestBracket | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      // No client-side "who am I" to set anymore — identity for voting
      // comes solely from the phone-verification session cookie, obtained
      // the first time this guest actually tries to vote.
      router.push("/vote");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
  );
}
