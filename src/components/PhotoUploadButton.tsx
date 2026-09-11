"use client";

import { useId, type ChangeEvent } from "react";

interface PhotoUploadButtonProps {
  /** Visible button text — set per call site (e.g. "Update Photo"). */
  label: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  accept?: string;
  disabled?: boolean;
}

/**
 * A real file input, visually hidden (sr-only, not display:none — stays
 * reachable by keyboard and screen readers) paired with a <label> styled as
 * a themed button. Native file inputs render inconsistently across browsers
 * and can't be restyled directly, so this is the standard workaround:
 * clicking/activating the label opens the file picker via `htmlFor`.
 */
export function PhotoUploadButton({ label, onChange, accept, disabled }: PhotoUploadButtonProps) {
  const id = useId();

  return (
    <>
      <input
        id={id}
        type="file"
        accept={accept}
        onChange={onChange}
        disabled={disabled}
        className="sr-only"
      />
      <label
        htmlFor={id}
        className={`inline-flex w-fit items-center justify-center rounded-lg bg-primary px-4 py-3 font-heading font-bold uppercase text-bg transition-opacity ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:opacity-90"
        }`}
      >
        {label}
      </label>
    </>
  );
}
