"use client";

import Link from "next/link";
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
 */
export function HomeNavButtons({ placeholderImage, navButtons }: HomeNavButtonsProps) {
  const { loaded, guests, activeGuest, isAdmin, setActiveGuestId, setGuests } = useCheckedInGuest();
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
        />
        {navButtons.map((btn) => (
          <GatedNavButton key={btn.href} href={btn.href} label={btn.label} activeGuest={activeGuest} />
        ))}
      </div>
    </>
  );
}
