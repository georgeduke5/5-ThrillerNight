"use client";

import type { VotingStatus } from "@/lib/data-access";
import { useVotingStatus } from "./useVotingStatus";
import { ToggleRow } from "./ToggleRow";

interface VotingStatusTogglesProps {
  initialStatus: VotingStatus;
}

/**
 * Costume-contest toggle switches: Voting Status and Results Visibility.
 * Rendered only on /admin/voting (Costume Contest) — the identity/access
 * toggles that used to live alongside these (Phone Verification, Passkey
 * Login, Self-Service Walk-In) now live exclusively in SecurityToggles on
 * the Security page.
 */
export function VotingStatusToggles({ initialStatus }: VotingStatusTogglesProps) {
  const { status, busy, error, updateStatus } = useVotingStatus(initialStatus);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ToggleRow
          label="Voting Status"
          on={status.isOpen}
          onLabel="Open"
          offLabel="Closed"
          onToggle={() => updateStatus({ isOpen: !status.isOpen })}
          disabled={busy}
        />
        <ToggleRow
          label="Results Visibility"
          on={status.resultsPublished}
          onLabel="Published"
          offLabel="Unpublished"
          onToggle={() => updateStatus({ resultsPublished: !status.resultsPublished })}
          disabled={busy}
        />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
