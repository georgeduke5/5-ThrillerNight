"use client";

import type { Guest } from "@/lib/data-access";

interface VoterIdentityBarProps {
  /** The only thing that differs between callers — e.g. "Voting as" (VotingApp) or "Guessing as" (CandyCountApp). */
  label: string;
  voter: Guest;
  /** Opens the caller's own GuestUpdateInfoModal — this component has no opinion on how that works. */
  onUpdateInfo: () => void;
  /** Opens the caller's own VerifyIdentityModal in "switch identity" mode — same, no opinion on how. */
  onChangeVoter: () => void;
}

/**
 * The "{label} as {name}" identity bar shown atop every guest-facing
 * contest page once a session is active — one shared component so the
 * costume-voting hub and the candy-count page stay visually identical
 * (same layout/typography/spacing/colors) and a future contest page gets
 * this for free, rather than each page growing its own slightly-different
 * copy. Only `label` differs between callers; `onUpdateInfo`/
 * `onChangeVoter` just invoke whichever modal-opening logic the calling
 * page already owns (GuestUpdateInfoModal / VerifyIdentityModal) — this
 * component never decides how identity is determined or changed, only how
 * the bar announcing it looks.
 */
export function VoterIdentityBar({ label, voter, onUpdateInfo, onChangeVoter }: VoterIdentityBarProps) {
  return (
    <div className="surface-panel flex items-center justify-between rounded-lg px-4 py-3">
      <p className="text-base text-text">
        {label}{" "}
        <button
          type="button"
          onClick={onUpdateInfo}
          className="font-heading text-lg font-bold uppercase text-primary underline decoration-dotted underline-offset-4"
        >
          {voter.firstName} {voter.lastName}
        </button>
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onUpdateInfo}
          className="text-base text-muted underline hover:text-text"
        >
          Update my info
        </button>
        <button
          type="button"
          onClick={onChangeVoter}
          className="text-base text-muted underline hover:text-text"
        >
          Not you?
        </button>
      </div>
    </div>
  );
}
