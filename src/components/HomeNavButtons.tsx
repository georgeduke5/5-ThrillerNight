"use client";

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
 */
export function HomeNavButtons({ placeholderImage, navButtons }: HomeNavButtonsProps) {
  const { loaded, guests, activeGuest, setActiveGuestId, setGuests } = useCheckedInGuest();
  return (
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
  );
}
