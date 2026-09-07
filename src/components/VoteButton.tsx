"use client";

import { CtaButton } from "@/components/CtaButton";
import { useCheckedInGuest } from "@/hooks/useCheckedInGuest";

/**
 * The home page's Vote button, gated on check-in status — presentation
 * only. /vote itself already correctly gates actual voting server-side on
 * the session cookie regardless of what this button shows, so this never
 * needs to (and doesn't) block navigation on its own; it just discourages
 * clicking through before checking in. Same size/position in both states
 * (a disabled look-alike, not a smaller pill) so there's no layout shift —
 * defaults to the disabled appearance while the check-in status is still
 * loading, rather than flashing enabled and then disabling.
 */
export function VoteButton() {
  const { activeGuest } = useCheckedInGuest();

  if (activeGuest) {
    return <CtaButton href="/vote">Vote</CtaButton>;
  }

  return (
    <span
      aria-disabled="true"
      title="Check in first"
      className="inline-block cursor-not-allowed select-none rounded-md border border-muted/40 bg-muted/20 px-8 py-4 text-center font-heading text-xl font-bold uppercase tracking-wide text-muted sm:text-2xl"
    >
      Check in first
    </span>
  );
}
