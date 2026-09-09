"use client";

import { useEffect, useRef, useState } from "react";
import type { Guest } from "@/lib/data-access";
import { CtaButton } from "@/components/CtaButton";

const HINT_DURATION_MS = 2000;

interface VoteButtonProps {
  activeGuest: Guest | null;
}

/**
 * The home page's Vote button, gated on check-in status — presentation
 * only. /vote itself already correctly gates actual voting server-side on
 * the session cookie regardless of what this button shows, so this never
 * needs to (and doesn't) block navigation on its own; it just discourages
 * clicking through before checking in. Same size/position in both states
 * (a disabled look-alike, not a smaller pill) so there's no layout shift —
 * defaults to the disabled appearance while the check-in status is still
 * loading, rather than flashing enabled and then disabling.
 *
 * The label always reads "Vote" — only the enabled/disabled look changes
 * with check-in status. Clicking while disabled shows a brief "Check in
 * first" popup instead of relabeling the button itself; aria-disabled
 * (not the native disabled attribute) is used deliberately so this click
 * still fires.
 */
export function VoteButton({ activeGuest }: VoteButtonProps) {
  const [showHint, setShowHint] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (activeGuest) {
    return <CtaButton href="/vote">Vote</CtaButton>;
  }

  function handleClick() {
    setShowHint(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowHint(false), HINT_DURATION_MS);
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-disabled="true"
        onClick={handleClick}
        className="inline-block cursor-not-allowed select-none rounded-md border border-muted/40 bg-muted/20 px-8 py-4 text-center font-heading text-xl font-bold uppercase tracking-wide text-muted sm:text-2xl"
      >
        Vote
      </button>
      {showHint && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-10 mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-3 py-1.5 text-sm text-text shadow-lg"
        >
          Check in first
        </span>
      )}
    </span>
  );
}
