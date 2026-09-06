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
 * The single "identify yourself" flow, reused everywhere this app needs to
 * know who's using it: the home page's "Check In" button, gating vote
 * submission the first time each session, and the "Not you?" affordance on
 * /vote for switching to a different guest. In every case identity ends up
 * living solely in the session cookie (see src/lib/auth/voterSession.ts),
 * never in anything client-supplied — this is the *only* place a guest
 * names themselves.
 *
 * After picking a name, this first asks the server whether that guest
 * already has a still-valid session on this browser (POST
 * /api/auth/phone/activate) — e.g. they verified earlier tonight, or are
 * switching back to someone who verified before someone else took over on
 * a shared device. If so, it switches to them immediately with no
 * phone/code prompt. Otherwise it falls through to the normal one-time
 * phone verification: phone -> code -> the server both marks them
 * checked-in and merges their new session in alongside any others already
 * on this browser, rather than replacing them.
 */
export function VerifyIdentityModal({ guests, onVerified, onCancel }: VerifyIdentityModalProps) {
  const [step, setStep] = useState<Step>("name");
  const [query, setQuery] = useState("");
  const [guestId, setGuestId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkingSession, setCheckingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return guests
      .filter((g) => `${g.firstName} ${g.lastName}`.toLowerCase().includes(q))
      .slice(0, MAX_MATCHES);
  }, [guests, query]);

  async function handlePickGuest(guest: Guest) {
    setGuestId(guest.id);
    setGuestName(`${guest.firstName} ${guest.lastName}`);
    setError(null);
    setCheckingSession(true);
    try {
      const res = await fetch("/api/auth/phone/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: guest.id }),
      });
      const body = (await res.json().catch(() => null)) as { switched?: boolean } | null;
      if (res.ok && body?.switched) {
        onVerified(guest.id);
        return;
      }
    } catch {
      // Fall through to the normal phone/code flow if the check itself fails.
    } finally {
      setCheckingSession(false);
    }
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
      aria-label="Verify your identity"
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
                    disabled={checkingSession}
                    className="w-full rounded px-4 py-2 text-left text-text hover:bg-bg disabled:opacity-60"
                  >
                    {checkingSession && guest.id === guestId
                      ? "Checking…"
                      : `${guest.firstName} ${guest.lastName}`}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onCancel}
              disabled={checkingSession}
              className="self-start text-sm text-muted underline hover:text-text disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        )}

        {step === "phone" && (
          <form onSubmit={handleSendCode} className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-bold uppercase text-text">Verify your phone</h2>
            <p className="text-sm text-muted">
              Hi {guestName}! We need a quick one-time phone check before continuing.
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
