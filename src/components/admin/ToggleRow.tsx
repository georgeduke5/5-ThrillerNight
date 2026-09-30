"use client";

interface ToggleRowProps {
  label: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
  onToggle: () => void;
  disabled: boolean;
}

/**
 * One on/off pill-switch row, shared by every admin status-toggle panel
 * (VotingStatusToggles, CandyCountStatusToggles) — extracted here once a
 * second caller needed the identical markup rather than duplicating it.
 */
export function ToggleRow({ label, on, onLabel, offLabel, onToggle, disabled }: ToggleRowProps) {
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
