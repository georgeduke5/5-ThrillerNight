"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Guest } from "@/lib/data-access";

export interface CheckedInGuestState {
  /** True once the initial session/guest-list fetch has resolved (success or failure) — lets callers avoid flashing an "unidentified" state before the real answer is known. */
  loaded: boolean;
  /** Every guest, fetched alongside the session check — reused by callers that also need the full list (e.g. to feed VerifyIdentityModal) so they don't have to fetch it again. */
  guests: Guest[];
  /** The guest bound to this browser's active session, or null if there isn't one. */
  activeGuest: Guest | null;
  /** Optimistically updates which guest is active without a re-fetch — call with a freshly-verified guestId right after VerifyIdentityModal's onVerified fires. */
  setActiveGuestId: (guestId: string | null) => void;
  /** Raw setter for the guest list — lets callers patch a single guest's fields in place after "Update my info" saves, without a full re-fetch. */
  setGuests: Dispatch<SetStateAction<Guest[]>>;
}

/**
 * Checks whether this browser already has an active, verified session (the
 * same session-derived identity the voting page and admin panel rely on —
 * see src/lib/auth/voterSession.ts, GET /api/votes) and resolves it to a
 * full Guest record. Called exactly once, in VotingButtons, and the
 * resulting state is passed down to CheckInButton and VoteButton as props
 * so both components share one fetch and one state instance. Calling this
 * hook in two sibling components creates two independent state instances
 * that don't communicate — VotingButtons is the correct and only call site.
 */
export function useCheckedInGuest(): CheckedInGuestState {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [sessionGuestId, setSessionGuestId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [guestsRes, votesRes] = await Promise.all([
          fetch("/api/guests", { cache: "no-store" }),
          fetch("/api/votes", { cache: "no-store" }),
        ]);
        const guestsBody = (await guestsRes.json().catch(() => null)) as { guests?: Guest[] } | null;
        const votesBody = (await votesRes.json().catch(() => null)) as { voterGuestId?: string | null } | null;
        if (cancelled) return;
        setGuests(guestsBody?.guests ?? []);
        setSessionGuestId(votesBody?.voterGuestId ?? null);
      } catch {
        // Leave unidentified — callers render their own fallback UI.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeGuest = guests.find((g) => g.id === sessionGuestId) ?? null;

  return { loaded, guests, activeGuest, setActiveGuestId: setSessionGuestId, setGuests };
}
