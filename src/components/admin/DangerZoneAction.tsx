"use client";

import { useState } from "react";

interface DangerZoneActionProps {
  buttonLabel: string;
  heading: string;
  /** What will be deleted and that it cannot be undone — shown in the confirmation dialog, not just this file's own doc comments. */
  description: string;
  endpoint: string;
  formatSuccess: (body: Record<string, unknown>) => string;
}

/**
 * One destructive admin action, gated behind an in-app (never
 * window.confirm) confirmation dialog that states exactly what will be
 * deleted and that it can't be undone, with Cancel and a red confirm
 * button — the confirm button stays disabled until the admin types DELETE,
 * so a reflexive click can't trigger it. Shared by both /admin/security
 * Danger Zone actions (see DangerZone.tsx) rather than duplicating the
 * dialog twice.
 */
export function DangerZoneAction({ buttonLabel, heading, description, endpoint, formatSuccess }: DangerZoneActionProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function openDialog() {
    setConfirmText("");
    setStatus(null);
    setOpen(true);
  }

  function closeDialog() {
    if (busy) return;
    setOpen(false);
  }

  async function handleConfirm() {
    setBusy(true);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) throw new Error((body?.error as string | undefined) ?? "The action failed.");
      setStatus({ ok: true, message: formatSuccess(body ?? {}) });
      setOpen(false);
    } catch (err) {
      setStatus({ ok: false, message: err instanceof Error ? err.message : "The action failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={openDialog}
        className="self-start rounded bg-red-600 px-3 py-2 text-sm font-bold text-white hover:bg-red-700"
      >
        {buttonLabel}
      </button>
      {status && <p className={`text-sm ${status.ok ? "text-accent" : "text-red-400"}`}>{status.message}</p>}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={heading}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeDialog}
        >
          <div className="w-full max-w-sm rounded-lg bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-lg font-bold uppercase text-red-400">{heading}</h3>
            <p className="mt-2 text-sm text-muted">{description}</p>
            <label htmlFor="danger-zone-confirm-text" className="mt-4 block text-sm text-muted">
              Type <span className="font-bold text-text">DELETE</span> to confirm.
            </label>
            <input
              id="danger-zone-confirm-text"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
              autoFocus
              autoComplete="off"
              className="field-input mt-2 w-full bg-bg px-3 py-2 text-text disabled:opacity-60"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={closeDialog}
                disabled={busy}
                className="flex-1 rounded bg-bg px-4 py-2 text-sm font-bold uppercase text-text disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={busy || confirmText !== "DELETE"}
                className="flex-1 rounded bg-red-600 px-4 py-2 text-sm font-bold uppercase text-white hover:bg-red-700 disabled:opacity-40"
              >
                {busy ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
