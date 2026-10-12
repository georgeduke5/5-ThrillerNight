"use client";

import { useEffect, useState } from "react";
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
 * rendering) — a guest who scanned the QR code on /admin/security lands on
 * "/?token=...", this claims it (POST /api/auth/checkin-gate/claim, which
 * re-validates it server-side against the current stored token and, on a
 * match, sets a short-lived cookie — see checkInGate.ts) and tells
 * CheckInButton to open the verification flow immediately, without the
 * guest needing to tap "Check In" first. The token is stripped from the
 * visible URL afterward either way, so it doesn't linger in browser
 * history.
 */
export function HomeNavButtons({ placeholderImage, navButtons }: HomeNavButtonsProps) {
  const { loaded, guests, activeGuest, isAdmin, setActiveGuestId, setGuests } = useCheckedInGuest();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [autoOpenCheckIn, setAutoOpenCheckIn] = useState(false);

  useEffect(() => {
    const token = searchParams.get("token");
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/checkin-gate/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
        if (!cancelled && res.ok && body?.ok) setAutoOpenCheckIn(true);
      } catch {
        // Ignore — guest just sees the normal homepage with no auto-open.
      } finally {
        if (!cancelled) router.replace("/");
      }
    })();
    return () => {
      cancelled = true;
    };
    // Reads whatever `token` the URL had at mount time only — this is a
    // one-shot claim attempt, not something that should re-run on every
    // searchParams/router identity change.
  }, []);

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
