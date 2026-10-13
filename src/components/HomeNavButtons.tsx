"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCheckedInGuest } from "@/hooks/useCheckedInGuest";
import { CheckInButton } from "@/components/CheckInButton";
import { GatedNavButton } from "@/components/GatedNavButton";

export interface NavButtonConfig {
  href: string;
  label: string;
}

interface HomeNavButtonsProps {
  placeholderImage: string;
  /**
   * Every feature entry point below Check-In, in display order. Adding a
   * future year's feature (e.g. trivia) is just adding one more entry here
   * — no layout changes needed. Each renders as a GatedNavButton, gated on
   * the same check-in status as the rest of this stack.
   */
  navButtons: NavButtonConfig[];
}

/**
 * Single client boundary on the home page that owns the one
 * useCheckedInGuest() call, then passes the resulting state down to
 * CheckInButton and every GatedNavButton so they share one instance and one
 * fetch instead of each maintaining an independent copy.
 *
 * The "Admin" link is the one piece that doesn't fit GatedNavButton's
 * pattern: everything else shows a disabled look-alike before check-in to
 * invite the guest to check in first, but there's nothing to invite a
 * non-admin guest toward — the whole point is that they never learn this
 * exists. It only ever renders once `isAdmin` comes back true for the
 * active session; see Guest.isAdmin and adminAccess.ts for what actually
 * gates /admin itself server-side (this link is just a shortcut to it, not
 * the access check). Fixed to the top-right corner (rather than inline
 * with the rest of this stack) and sized to be unmissable, not a quiet
 * afterthought — George needs to find it at a glance at the door.
 *
 * Also owns claiming a party-presence token carried in this page's own URL
 * (see src/app/page.tsx, which wraps this in a <Suspense> boundary so
 * useSearchParams here doesn't force the whole page to opt out of static
 * rendering) — a guest who scanned the QR code on /admin/security, or who
 * pasted a check-in link copied by hand (see README's admin-recovery
 * section), lands on "/?token=...". This claims it (POST
 * /api/auth/checkin-gate/claim, which re-validates it server-side against
 * the current stored token — see checkInGate.ts — and, on a match, sets a
 * short-lived cookie) and tells CheckInButton to open the verification flow
 * immediately, without the guest needing to tap "Check In" first.
 *
 * Three distinct outcomes, each handled differently (this used to collapse
 * all three into the same silent "nothing happens" result, which is what
 * made a guest with a perfectly good but whitespace-mangled hand-copied
 * token land on the locked screen with zero indication why — see
 * checkInGate.ts's normalizeToken for the actual fix to that, and 503
 * below for the other bug this compounded with):
 * - A clean match (ok: true): opens check-in immediately, and the token is
 *   stripped from the visible URL — a definitive outcome, safe to leave
 *   behind.
 * - A clean rejection (res.ok but body.ok === false: the code genuinely
 *   doesn't match anything currently stored, e.g. it was superseded by a
 *   newer "Generate New Code") is just as definitive, so the token is
 *   stripped here too, but now with an actual message explaining it instead
 *   of silence.
 * - Anything else — a thrown/network error, or a 5xx (the route's own
 *   Sheets read genuinely failed; see claim/route.ts's 503) — is NOT
 *   definitive: retrying a moment later could well succeed, so the token is
 *   deliberately left in the URL and a retry button re-runs the exact same
 *   claim against it, rather than forcing the guest to go re-scan/re-paste
 *   the same link that was never actually proven wrong.
 */
export function HomeNavButtons({ placeholderImage, navButtons }: HomeNavButtonsProps) {
  const { loaded, guests, activeGuest, isAdmin, setActiveGuestId, setGuests } = useCheckedInGuest();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [autoOpenCheckIn, setAutoOpenCheckIn] = useState(false);
  const [claimOutcome, setClaimOutcome] = useState<"invalid" | "retryable" | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Set once on unmount (see the cleanup-only effect below) and checked
  // after every await in attemptClaim — shared across both call sites (the
  // initial mount attempt and a later manual retry), unlike a plain local
  // `cancelled` variable scoped to one call, which can't be flipped by an
  // unmount that happens after that call's own async work already started.
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const attemptClaim = useCallback(
    async (token: string) => {
      try {
        const res = await fetch("/api/auth/checkin-gate/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (unmountedRef.current) return;

        if (res.ok && body?.ok) {
          setClaimOutcome(null);
          setAutoOpenCheckIn(true);
          router.replace("/"); // definitive success — safe to drop from the URL
          return;
        }
        if (res.status >= 500 || body === null) {
          // The route itself failed, or returned something unparseable —
          // never proven wrong, so the URL keeps the token for a retry.
          setClaimOutcome("retryable");
          return;
        }
        // A definitive, well-formed "no" (ok: false from a normal
        // response) — this code really doesn't match anything currently
        // stored.
        setClaimOutcome("invalid");
        router.replace("/");
      } catch {
        // A network-level failure (offline, DNS, etc.) is exactly as
        // unproven as a 5xx — same retryable treatment, token kept.
        if (!unmountedRef.current) setClaimOutcome("retryable");
      }
    },
    [router],
  );

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) return;
    attemptClaim(token);
    // Reads whatever `token` the URL had at mount time only — this is a
    // one-shot claim attempt, not something that should re-run on every
    // searchParams/router identity change. A later retry (see handleRetry
    // below) re-reads the current URL explicitly instead of depending on
    // this effect firing again.
  }, []);

  async function handleRetry() {
    const token = searchParams.get("token");
    if (!token) return; // shouldn't happen — the retry button only renders while it's still present
    setRetrying(true);
    try {
      await attemptClaim(token);
    } finally {
      if (!unmountedRef.current) setRetrying(false);
    }
  }

  return (
    <>
      {isAdmin && (
        <Link
          href="/admin"
          className="fixed right-4 top-4 z-20 font-heading text-xl font-bold uppercase text-primary underline sm:text-2xl"
        >
          Admin
        </Link>
      )}
      <div className="flex flex-col items-center gap-4">
        {claimOutcome === "invalid" && (
          <p className="max-w-xs text-center text-base text-red-400" role="alert">
            That check-in code is no longer valid. Please scan the current code at the door.
          </p>
        )}
        {claimOutcome === "retryable" && (
          <div className="flex max-w-xs flex-col items-center gap-2 text-center" role="alert">
            <p className="text-base text-red-400">Couldn&rsquo;t verify the code, please try again.</p>
            <button
              type="button"
              onClick={handleRetry}
              disabled={retrying}
              className="rounded bg-bg px-4 py-2 text-sm font-bold uppercase text-text underline disabled:opacity-60"
            >
              {retrying ? "Retrying…" : "Try again"}
            </button>
          </div>
        )}
        <CheckInButton
          placeholderImage={placeholderImage}
          loaded={loaded}
          guests={guests}
          activeGuest={activeGuest}
          setActiveGuestId={setActiveGuestId}
          setGuests={setGuests}
          autoOpen={autoOpenCheckIn}
        />
        {navButtons.map((btn) => (
          <GatedNavButton key={btn.href} href={btn.href} label={btn.label} activeGuest={activeGuest} />
        ))}
      </div>
    </>
  );
}
