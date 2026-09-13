"use client";

import type { VotingStatus } from "@/lib/data-access";
import { useVotingStatus } from "./useVotingStatus";

interface VotingStatusTogglesProps {
  initialStatus: VotingStatus;
}

/**
 * Dashboard-level voting-status controls (requirements Section 5.4): the
 * same four switches that used to require a click-through to /admin/voting
 * (VotingControls), now visible and toggleable directly on the dashboard.
 * Shares its update behavior with VotingControls via useVotingStatus so the
 * two stay identical in shape even though each holds its own status copy.
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

      {!status.phoneVerificationEnabled && (
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

function ToggleRow({
  label,
  on,
  onLabel,
  offLabel,
  onToggle,
  disabled,
}: {
  label: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <div className="surface-panel flex items-center justify-between gap-4 rounded-lg p-4">
      <span className="font-heading font-bold uppercase text-text">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        disabled={disabled}
        className="flex shrink-0 items-center gap-3 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className={`text-xs font-bold uppercase ${on ? "text-primary" : "text-muted"}`}>
          {on ? onLabel : offLabel}
        </span>
        <span
          aria-hidden="true"
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
            on ? "bg-primary" : "bg-muted/30"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              on ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </span>
      </button>
    </div>
  );
}
