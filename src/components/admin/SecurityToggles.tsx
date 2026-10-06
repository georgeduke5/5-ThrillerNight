"use client";

import type { VotingStatus } from "@/lib/data-access";
import { useVotingStatus } from "./useVotingStatus";
import { ToggleRow } from "./ToggleRow";

interface SecurityTogglesProps {
  initialStatus: VotingStatus;
}

/**
 * Identity/access toggle switches — Phone Verification, Passkey Login,
 * In-Person Check-In, and Self-Service Walk-In — split out of the old
 * VotingStatusToggles (which used to render all five voting+security
 * toggles on both the dashboard and /admin/voting) so these live only on
 * the Security page. Voting Status and Results Visibility are the
 * costume-contest-specific counterpart, now exclusive to
 * VotingStatusToggles on /admin/voting.
 *
 * Phone Verification, Passkey Login, and In-Person Check-In are each one
 * of the check-in method-selection screen's three options
 * (VerifyIdentityModal.tsx): turning one off hides that button entirely
 * and makes its routes reject every request, not just softens it. If all
 * three are off, a guest is checked in automatically after picking their
 * name, with no method screen at all.
 */
export function SecurityToggles({ initialStatus }: SecurityTogglesProps) {
  const { status, busy, error, updateStatus } = useVotingStatus(initialStatus);
  const noMethodsEnabled =
    !status.passkeyAuthEnabled && !status.phoneVerificationEnabled && !status.inPersonCheckInEnabled;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ToggleRow
          label="Passkey Login"
          on={status.passkeyAuthEnabled}
          onLabel="On"
          offLabel="Off"
          onToggle={() => updateStatus({ passkeyAuthEnabled: !status.passkeyAuthEnabled })}
          disabled={busy}
        />
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
          label="In-Person Check-In"
          on={status.inPersonCheckInEnabled}
          onLabel="On"
          offLabel="Off"
          onToggle={() =>
            updateStatus({ inPersonCheckInEnabled: !status.inPersonCheckInEnabled })
          }
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

      {!status.phoneVerificationEnabled && (
        <p className="text-sm text-accent">
          Phone Verification is off — &ldquo;Phone Number&rdquo; no longer appears as a check-in
          option at all.
        </p>
      )}

      {!status.inPersonCheckInEnabled && (
        <p className="text-sm text-accent">
          In-Person Check-In is off — &ldquo;In-Person&rdquo; no longer appears as a check-in
          option, and no guest can reach the pending-approval waiting screen this way.
        </p>
      )}

      {noMethodsEnabled && (
        <p className="text-sm font-bold text-red-400">
          All three check-in methods are off — guests are checked in automatically after picking
          their name, with no verification of any kind.
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
