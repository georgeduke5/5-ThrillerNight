"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { Guest } from "@/lib/data-access";

interface VerifyIdentityModalProps {
  guests: Guest[];
  onVerified: (guestId: string) => void;
  onCancel: () => void;
}

const MAX_MATCHES = 20;

type Step = "name" | "phone" | "code";

/**
 * Gates vote submission (not browsing) behind identity. Since identity is
 * now solely the session cookie (not a name picked elsewhere in the UI —
 * see requirements: a guest can't cast a vote under someone else's
 * identity by searching or typing their name), this is the *only* place a
 * guest names themselves for voting purposes, and it only ever happens at
 * the moment they try to actually vote with no valid session yet: pick
 * your name -> phone -> one-time code. On success, the server sets a
 * signed session cookie (see src/lib/auth/voterSession.ts) bound to
 * whichever guest was picked here, and the caller retries whatever vote
 * triggered this modal.
 */
export function VerifyIdentityModal({ guests, onVerified, onCancel }: VerifyIdentityModalProps) {
  const [step, setStep] = useState<Step>("name");
  const [query, setQuery] = useState("");
  const [guestId, setGuestId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return guests
      .filter((g) => `${g.firstName} ${g.lastName}`.toLowerCase().includes(q))
      .slice(0, MAX_MATCHES);
  }, [guests, query]);

  function handlePickGuest(guest: Guest) {
    setGuestId(guest.id);
    setGuestName(`${guest.firstName} ${guest.lastName}`);
    setError(null);
    setStep("phone");
  }

  async function handleSendCode(event: FormEvent) {
    event.preventDefault();
    if (!guestId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/phone/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, phone }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to send verification code.");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCheckCode(event: FormEvent) {
    event.preventDefault();
    if (!guestId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/phone/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, phone, code }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Incorrect code.");
      onVerified(guestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Verify your identity to vote"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={submitting ? undefined : onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "name" && (
          <div className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Who are you?</h2>
            <p className="text-sm text-muted">We need to know who&rsquo;s voting before you can cast a vote.</p>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Start typing your name…"
              className="field-input w-full bg-bg px-4 py-3 text-lg text-text"
              autoFocus
            />
            {query && matches.length === 0 && (
              <p className="text-muted">
                No match.{" "}
                <a href="/vote/walkin" className="text-primary underline">
                  Didn&rsquo;t RSVP? Add yourself here
                </a>
                .
              </p>
            )}
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {matches.map((guest) => (
                <li key={guest.id}>
                  <button
                    type="button"
                    onClick={() => handlePickGuest(guest)}
                    className="w-full rounded px-4 py-2 text-left text-text hover:bg-bg"
                  >
                    {guest.firstName} {guest.lastName}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onCancel}
              className="self-start text-sm text-muted underline hover:text-text"
            >
              Cancel
            </button>
          </div>
        )}

        {step === "phone" && (
          <form onSubmit={handleSendCode} className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Verify to vote</h2>
            <p className="text-sm text-muted">
              Hi {guestName}! Voting requires a quick one-time phone check. Browsing photos doesn&rsquo;t.
            </p>
            <label htmlFor="voter-phone" className="text-sm text-muted">
              Phone number
            </label>
            <input
              id="voter-phone"
              type="tel"
              required
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className="field-input bg-bg px-4 py-3 text-text"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("name");
                  setError(null);
                }}
                className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || !phone}
                className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send code"}
              </button>
            </div>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleCheckCode} className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Enter code</h2>
            <label htmlFor="voter-code" className="text-sm text-muted">
              Enter the code sent to {phone}
            </label>
            <input
              id="voter-code"
              type="text"
              inputMode="numeric"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="field-input bg-bg px-4 py-3 text-center text-lg tracking-widest text-text"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
                className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={submitting || !code}
                className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
              >
                {submitting ? "Verifying…" : "Verify"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
