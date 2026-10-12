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
 * Guests no longer pick a check-in method — name selection (gated on the
 * party-presence code below) goes straight into the passkey flow, with an
 * on-file-phone SMS code required first for a guest's very first passkey
 * (Phone Verification) and an admin's in-person approval as the fallback
 * when that can't complete (In-Person Check-In). Turning a toggle off
 * doesn't just soften its step — the matching route rejects every request
 * regardless of what any client shows. If all three are off, a guest is
 * checked in automatically after picking their name, with no verification
 * of any kind.
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
          Passkey login is on — guests confirm with Face ID / fingerprint after picking their name.
          A guest whose passkey won&rsquo;t work needs an admin to check them in.
        </p>
      )}

      {!status.passkeyAuthEnabled && (
        <p className="text-sm font-bold text-red-400">
          Passkey Login is off — it&rsquo;s the only automated way to check in, so every guest is
          now sent straight to needing an admin for in-person approval.
        </p>
      )}

      {!status.phoneVerificationEnabled && (
        <p className="text-sm text-accent">
          Phone Verification is off — a guest&rsquo;s very first passkey registration no longer
          requires confirming a code sent to their on-file number.
        </p>
      )}

      {!status.inPersonCheckInEnabled && (
        <p className="text-sm text-accent">
          In-Person Check-In is off — a guest whose passkey flow fails is no longer offered a way
          to reach the pending-approval waiting screen.
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
