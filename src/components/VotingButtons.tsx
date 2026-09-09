"use client";

import { useCheckedInGuest } from "@/hooks/useCheckedInGuest";
import { CheckInButton } from "@/components/CheckInButton";
import { VoteButton } from "@/components/VoteButton";

interface VotingButtonsProps {
  placeholderImage: string;
}

/**
 * Single client boundary on the home page that owns the one
 * useCheckedInGuest() call, then passes the resulting state down to both
 * CheckInButton and VoteButton so they share one instance and one fetch
 * instead of each maintaining an independent copy.
 */
export function VotingButtons({ placeholderImage }: VotingButtonsProps) {
  const { loaded, guests, activeGuest, setActiveGuestId, setGuests } = useCheckedInGuest();
  return (
    <>
      <CheckInButton
        placeholderImage={placeholderImage}
        loaded={loaded}
        guests={guests}
        activeGuest={activeGuest}
        setActiveGuestId={setActiveGuestId}
        setGuests={setGuests}
      />
      <VoteButton activeGuest={activeGuest} />
    </>
  );
}
