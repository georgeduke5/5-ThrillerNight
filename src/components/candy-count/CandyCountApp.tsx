"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { CandyCountStatus, Guest } from "@/lib/data-access";
import { VerifyIdentityModal } from "@/components/voting/VerifyIdentityModal";
import { GuestUpdateInfoModal, type GuestEdits } from "@/components/GuestUpdateInfoModal";
import { VoterIdentityBar } from "@/components/VoterIdentityBar";

interface CandyCountAppProps {
  /** config.theme.placeholderImage — passed straight through to GuestUpdateInfoModal's photo field, same as VotingApp does. */
  placeholderImage: string;
}

type PendingAction = { type: "guess" } | { type: "switch" };

/**
 * The Candy Count guest-facing app — identity flow mirrors VotingApp
 * exactly, including the "Guessing as {name}" bar (VoterIdentityBar, the
 * same component VotingApp's "Voting as" bar uses) with its "Update my
 * info" and "Not you?" affordances: switching reuses VerifyIdentityModal
 * exactly as the vote-submission retry already did (both now go through
 * the same `pendingAction` state, distinguished by `type`), and "Update my
 * info" reuses GuestUpdateInfoModal exactly as VotingApp does, against the
 * same PATCH /api/guests/[id] and POST /api/photos endpoints. None of that
 * changes how identity is actually determined — browsing/loading is always
 * open, submitting is gated on a verified session cookie, same as before.
 *
 * Resubmitting overwrites the guest's prior guess (POST /api/candy-count is
 * an upsert), same pattern as costume voting.
 */
export function CandyCountApp({ placeholderImage }: CandyCountAppProps) {
  const [guests, setGuests] = useState<Guest[] | null>(null);
  const [status, setStatus] = useState<CandyCountStatus | null>(null);
  const [sessionGuestId, setSessionGuestId] = useState<string | null>(null);
  const [currentGuess, setCurrentGuess] = useState<number | null>(null);
  const [guessInput, setGuessInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [showUpdateInfoModal, setShowUpdateInfoModal] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [guestsRes, statusRes, guessRes] = await Promise.all([
        fetch("/api/guests", { cache: "no-store" }),
        fetch("/api/candy-count/status", { cache: "no-store" }),
        fetch("/api/candy-count", { cache: "no-store" }),
      ]);
      if (!guestsRes.ok || !statusRes.ok || !guessRes.ok) {
        throw new Error("Failed to load candy count data.");
      }
      const guestsBody = (await guestsRes.json()) as { guests: Guest[] };
      const statusBody = (await statusRes.json()) as CandyCountStatus;
      const guessBody = (await guessRes.json()) as { guestId: string | null; guess: number | null };

      setGuests(guestsBody.guests);
      setStatus(statusBody);
      setSessionGuestId(guessBody.guestId);
      setCurrentGuess(guessBody.guess);
      // Only ever pre-fills from the server on this initial load, never on
      // a later re-fetch — this component doesn't poll in the background,
      // so there's no risk of clobbering a guess the guest is mid-typing.
      setGuessInput(guessBody.guess !== null ? String(guessBody.guess) : "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load candy count data.");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const voter = useMemo(
    () => guests?.find((g) => g.id === sessionGuestId) ?? null,
    [guests, sessionGuestId],
  );

  function handleChangeVoter() {
    // Non-destructive, same as VotingApp.handleChangeVoter: only opens the
    // identify-yourself modal, letting the guest pick a different name. The
    // active session doesn't actually change unless they complete that.
    setPendingAction({ type: "switch" });
  }

  /**
   * Validates the same rules the server enforces (POST /api/candy-count) —
   * duplicated deliberately for instant feedback, never trusted instead of
   * the server's own re-check.
   */
  function validateGuess(raw: string): { value: number } | { error: string } {
    const trimmed = raw.trim();
    if (trimmed === "") return { error: "Enter a whole number." };
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return { error: "Enter a whole number." };
    if (!Number.isInteger(parsed)) return { error: "Guess must be a whole number — no decimals." };
    if (parsed < 0) return { error: "Guess can't be negative." };
    return { value: parsed };
  }

  async function submitGuess(guess: number) {
    setSubmitting(true);
    setSubmitError(null);
    setJustSaved(false);
    try {
      const res = await fetch("/api/candy-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guess }),
      });
      if (res.status === 401) {
        const body = (await res.json().catch(() => null)) as { requiresVerification?: boolean } | null;
        if (body?.requiresVerification) {
          setPendingAction({ type: "guess" });
          return; // swallow — VerifyIdentityModal's onVerified will retry
        }
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Failed to submit your guess.");
      }
      const body = (await res.json()) as { guess: number };
      setCurrentGuess(body.guess);
      setJustSaved(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit your guess.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const result = validateGuess(guessInput);
    if ("error" in result) {
      setSubmitError(result.error);
      return;
    }
    setSubmitError(null);
    submitGuess(result.value).catch(() => {
      // Surfaced via submitError above.
    });
  }

  async function handleVerified(guestId: string) {
    setSessionGuestId(guestId);
    const action = pendingAction;
    setPendingAction(null);
    if (action?.type === "switch") {
      // Mirrors VotingApp.handleVerified: refresh identity and this guest's
      // own existing guess (if any) so the form doesn't keep showing the
      // previous guest's typed value under the new guest's name.
      await load();
      return;
    }
    // "guess": retry with whatever's currently in the input — the guest
    // didn't lose their typed value while the verification modal was open.
    const result = validateGuess(guessInput);
    if ("value" in result) {
      submitGuess(result.value).catch(() => {
        // Surfaced via submitError above.
      });
    }
  }

  async function handleSaveGuestInfo(id: string, updates: GuestEdits) {
    const res = await fetch(`/api/guests/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const body = (await res.json().catch(() => null)) as { guest?: Guest; error?: string } | null;
    if (!res.ok || !body?.guest) throw new Error(body?.error ?? "Failed to update your info.");
    const savedGuest = body.guest;
    setGuests((prev) => prev?.map((g) => (g.id === id ? savedGuest : g)) ?? prev);
  }

  async function handleSaveGuestPhoto(id: string, blob: Blob) {
    const formData = new FormData();
    formData.append("file", blob, "photo.jpg");
    formData.append("guestId", id);
    const res = await fetch("/api/photos", { method: "POST", body: formData });
    const body = (await res.json().catch(() => null)) as
      | { photoUrl?: string; photoRef?: string; error?: string }
      | null;
    if (!res.ok || !body?.photoUrl) throw new Error(body?.error ?? "Failed to upload photo.");
    setGuests(
      (prev) =>
        prev?.map((g) =>
          g.id === id ? { ...g, photoUrl: body.photoUrl as string, photoRef: body.photoRef ?? null } : g,
        ) ?? prev,
    );
  }

  if (loadError) {
    return <p className="surface-panel rounded p-4 text-center text-red-400">{loadError}</p>;
  }

  if (!guests || !status) {
    return <p className="text-center text-muted">Loading…</p>;
  }

  if (!status.guessingOpen) {
    return (
      <div className="surface-panel rounded-lg p-8 text-center">
        <p className="font-heading text-xl font-bold uppercase text-text">
          Guessing Is Currently Closed
        </p>
        <p className="mt-2 text-muted">Check back once the hosts open the candy count contest.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {voter && (
        <VoterIdentityBar
          label="Guessing as"
          voter={voter}
          onUpdateInfo={() => setShowUpdateInfoModal(true)}
          onChangeVoter={handleChangeVoter}
        />
      )}

      <form
        onSubmit={handleSubmit}
        className="surface-panel flex flex-col items-center gap-4 rounded-lg p-6 text-center"
      >
        <label htmlFor="candy-guess" className="font-heading text-2xl font-bold uppercase text-text">
          How many pieces of candy?
        </label>
        <input
          id="candy-guess"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={guessInput}
          onChange={(e) => {
            setGuessInput(e.target.value);
            setJustSaved(false);
          }}
          placeholder="Your guess"
          className="field-input w-40 bg-bg px-4 py-3 text-center text-2xl text-text"
          autoComplete="off"
        />
        {submitError && <p className="text-base text-red-400">{submitError}</p>}
        {justSaved && !submitError && (
          <p className="text-base text-primary">
            Guess saved{currentGuess !== null ? `: ${currentGuess}` : ""}! Submit again anytime to
            change it.
          </p>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-primary px-8 py-4 font-heading text-xl font-bold uppercase tracking-wide text-bg shadow-lg transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:opacity-60 sm:text-2xl"
        >
          {submitting ? "Saving…" : currentGuess !== null ? "Update My Guess" : "Submit My Guess"}
        </button>
      </form>

      {pendingAction && (
        <VerifyIdentityModal
          guests={guests}
          onVerified={handleVerified}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {showUpdateInfoModal && voter && (
        <GuestUpdateInfoModal
          guest={voter}
          placeholderImage={placeholderImage}
          onSave={(updates) => handleSaveGuestInfo(voter.id, updates)}
          onPhotoCropped={(blob) => handleSaveGuestPhoto(voter.id, blob)}
          onClose={() => setShowUpdateInfoModal(false)}
        />
      )}
    </div>
  );
}
