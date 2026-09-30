"use client";

import type { VotingStatus } from "@/lib/data-access";
import { useVotingStatus } from "./useVotingStatus";
import { ToggleRow } from "./ToggleRow";

interface SecurityTogglesProps {
  initialStatus: VotingStatus;
}

/**
 * Identity/access toggle switches — Phone Verification, Passkey Login, and
 * Self-Service Walk-In — split out of the old VotingStatusToggles (which
 * used to render all five voting+security toggles on both the dashboard and
 * /admin/voting) so these live only on the Security page. Voting Status and
 * Results Visibility are the costume-contest-specific counterpart, now
 * exclusive to VotingStatusToggles on /admin/voting.
 */
export function SecurityToggles({ initialStatus }: SecurityTogglesProps) {
  const { status, busy, error, updateStatus } = useVotingStatus(initialStatus);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ToggleRow
          label="Phone Verification"
          on={status.phoneVerificationEnabled}
          onLabel="On"
          offLabel="Off"
          onToggle={() =>
            updateStatus({ phoneVerificationEnabled: !status.phoneVerificationEnabled })
          }
          disabled={busy}
        />
        <ToggleRow
          label="Passkey Login"
          on={status.passkeyAuthEnabled}
          onLabel="On"
          offLabel="Off"
          onToggle={() => updateStatus({ passkeyAuthEnabled: !status.passkeyAuthEnabled })}
          disabled={busy}
        />
        <ToggleRow
          label="Self-Service Walk-In"
          on={status.selfServiceWalkinEnabled}
          onLabel="On"
          offLabel="Off"
          onToggle={() =>
            updateStatus({ selfServiceWalkinEnabled: !status.selfServiceWalkinEnabled })
          }
          disabled={busy}
        />
      </div>

      {status.passkeyAuthEnabled && (
        <p className="text-sm text-accent">
          Passkey login is on — guests confirm with Face ID / fingerprint after picking their name,
          and no SMS is sent. A guest whose passkey won&rsquo;t work needs an admin to cast their
          vote for them.
        </p>
      )}

      {!status.passkeyAuthEnabled && !status.phoneVerificationEnabled && (
        <p className="text-sm text-accent">
          Phone verification is off — guests can check in and vote without a real SMS code.
        </p>
      )}

      {!status.selfServiceWalkinEnabled && (
        <p className="text-sm text-accent">
          Self-service walk-in is off — /vote/walkin is disabled and its link no longer appears
          when a guest can&rsquo;t find their name.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
