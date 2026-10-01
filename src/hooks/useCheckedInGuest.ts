"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { Guest } from "@/lib/data-access";

export interface CheckedInGuestState {
  /** True once the initial session/guest-list fetch has resolved (success or failure) — lets callers avoid flashing an "unidentified" state before the real answer is known. */
  loaded: boolean;
  /** Every guest, fetched alongside the session check — reused by callers that also need the full list (e.g. to feed VerifyIdentityModal) so they don't have to fetch it again. */
  guests: Guest[];
  /** The guest bound to this browser's active session, or null if there isn't one. */
  activeGuest: Guest | null;
  /**
   * Whether the active guest is admin-flagged — informational only, for
   * showing/hiding the "Admin" link. The actual gate on /admin/* is a
   * separate, independent server-side check (adminAccess.ts) that doesn't
   * trust this value or anything else client-supplied.
   */
  isAdmin: boolean;
  /**
   * Updates which guest is active — call with a freshly-verified guestId
   * right after VerifyIdentityModal's onVerified fires. Optimistic for
   * `activeGuest` itself (looked up from the already-fetched public
   * `guests` list, no re-fetch needed), but `isAdmin` can't be derived that
   * way (it's deliberately absent from the public guest shape — see
   * Guest.isAdmin), so this re-checks GET /api/auth/session for the newly
   * active guest. Without this, an admin-flagged guest who just verified
   * wouldn't see the "Admin" link appear until a full page reload.
   */
  setActiveGuestId: (guestId: string | null) => void;
  /** Raw setter for the guest list — lets callers patch a single guest's fields in place after "Update my info" saves, without a full re-fetch. */
  setGuests: Dispatch<SetStateAction<Guest[]>>;
}

/**
 * Checks whether this browser already has an active, verified session (the
 * same session-derived identity the voting page, candy count page, and
 * admin panel rely on — see src/lib/auth/voterSession.ts, GET
 * /api/auth/session) and resolves it to a full Guest record. Called exactly
 * once, in HomeNavButtons, and the resulting state is passed down to
 * CheckInButton and each GatedNavButton as props so they all share one
 * fetch and one state instance. Calling this hook in two sibling components
 * creates two independent state instances that don't communicate —
 * HomeNavButtons is the correct and only call site.
 *
 * Identity comes from GET /api/auth/session rather than GET /api/votes
 * deliberately: the latter 404s when votingModuleEnabled is off, which
 * would break check-in/candy-count gating too if voting alone were
 * disabled. /api/auth/session is a generic, never-gated identity check.
 */
export function useCheckedInGuest(): CheckedInGuestState {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [sessionGuestId, setSessionGuestId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [guestsRes, sessionRes] = await Promise.all([
          fetch("/api/guests", { cache: "no-store" }),
          fetch("/api/auth/session", { cache: "no-store" }),
        ]);
        const guestsBody = (await guestsRes.json().catch(() => null)) as { guests?: Guest[] } | null;
        const sessionBody = (await sessionRes.json().catch(() => null)) as {
          guestId?: string | null;
          isAdmin?: boolean;
        } | null;
        if (cancelled) return;
        setGuests(guestsBody?.guests ?? []);
        setSessionGuestId(sessionBody?.guestId ?? null);
        setIsAdmin(sessionBody?.isAdmin ?? false);
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

  const setActiveGuestId = useCallback((guestId: string | null) => {
    setSessionGuestId(guestId);
    if (!guestId) {
      setIsAdmin(false);
      return;
    }
    fetch("/api/auth/session", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { isAdmin?: boolean }) => setIsAdmin(body?.isAdmin ?? false))
      .catch(() => setIsAdmin(false));
  }, []);

  return { loaded, guests, activeGuest, isAdmin, setActiveGuestId, setGuests };
}
