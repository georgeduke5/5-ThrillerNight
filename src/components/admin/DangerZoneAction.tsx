"use client";

import { useState } from "react";

/**
 * Which Danger Zone action this is, for building the success message from
 * the response body — see formatSuccessMessage below. A plain string
 * rather than a `formatSuccess` function prop: DangerZone.tsx (the server
 * component that renders this) can't pass a function across the server/
 * client boundary (React serializes props for Client Components; a
 * function isn't serializable), so the message-building logic has to live
 * here instead, keyed on this.
 */
export type DangerZoneActionKind = "reset-voting-data" | "reset-sessions" | "reset-to-admins-only";

interface DangerZoneActionProps {
  buttonLabel: string;
  heading: string;
  /** What will be deleted and that it cannot be undone — shown in the confirmation dialog, not just this file's own doc comments. */
  description: string;
  endpoint: string;
  kind: DangerZoneActionKind;
}

/** Builds this action's success message straight from its own response body — see DangerZoneActionKind's doc comment for why this lives here instead of a prop. */
function formatSuccessMessage(kind: DangerZoneActionKind, body: Record<string, unknown>): string {
  switch (kind) {
    case "reset-voting-data":
      return `Deleted ${Number(body.votesCleared ?? 0)} vote(s) and ${Number(body.guessesCleared ?? 0)} guess(es).`;
    case "reset-sessions":
      return `Signed out all non-admin guests and removed ${Number(body.passkeysDeleted ?? 0)} passkey(s).`;
    case "reset-to-admins-only":
      return "Reset complete. You've been signed out too, so you'll need to sign back in on your next action.";
  }
}

type ResetCountsBody = Partial<Record<"guests" | "votes" | "candyGuesses" | "passkeys" | "groupsDeleted" | "groupsCleaned" | "photosDeleted", number>>;

function describeCounts(c: ResetCountsBody): string {
  return [
    `${c.guests ?? 0} guest(s)`,
    `${c.votes ?? 0} vote(s)`,
    `${c.candyGuesses ?? 0} candy guess(es)`,
    `${c.passkeys ?? 0} passkey(s)`,
    `${c.groupsDeleted ?? 0} empty group(s)`,
    `${c.groupsCleaned ?? 0} group(s) cleaned up`,
    ...(c.photosDeleted !== undefined ? [`${c.photosDeleted} photo(s)`] : []),
  ].join(", ");
}

/** "Reset to admins only"'s step-by-step report (see DataStore.resetToAdminsOnly), success or not. */
function resetReportLines(body: Record<string, unknown>): string[] | undefined {
  const steps = body.steps as Array<{ step: string; ok: boolean; detail: string }> | undefined;
  if (!Array.isArray(steps)) return undefined;
  const lines = steps.map((s) => `${s.ok ? "✓" : "✗"} ${s.step}: ${s.detail}`);
  const adminsKept = body.adminsKept as string[] | undefined;
  if (adminsKept?.length) lines.push(`Kept as admins: ${adminsKept.join(", ")}`);
  if (body.wiped) lines.push(`Deleted: ${describeCounts(body.wiped as ResetCountsBody)}`);
  const remaining = body.remaining as ResetCountsBody | null | undefined;
  if (remaining === null) {
    lines.push("Still there: unknown (couldn't re-read the sheet)");
  } else if (remaining && Object.values(remaining).some((n) => n)) {
    lines.push(`Still there: ${describeCounts(remaining)}`);
  }
  const photosNotDeleted = body.photosNotDeleted as string[] | undefined;
  if (photosNotDeleted?.length) {
    lines.push(`Photo files to delete by hand from the Drive folder: ${photosNotDeleted.join(", ")}`);
  }
  return lines;
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
export function DangerZoneAction({ buttonLabel, heading, description, endpoint, kind }: DangerZoneActionProps) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string; details?: string[] } | null>(null);

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
      const details = kind === "reset-to-admins-only" && body ? resetReportLines(body) : undefined;
      if (!res.ok) {
        // A failed reset still says what it got through, so close the
        // dialog and show that rather than a bare error.
        if (details) {
          setStatus({ ok: false, message: (body?.error as string | undefined) ?? "The action failed.", details });
          setOpen(false);
          return;
        }
        throw new Error((body?.error as string | undefined) ?? "The action failed.");
      }
      setStatus({ ok: true, message: formatSuccessMessage(kind, body ?? {}), details });
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
      {status && (
        <div role="status" className={`text-sm ${status.ok ? "text-accent" : "text-red-400"}`}>
          <p>{status.message}</p>
          {status.details && (
            <ul className="mt-1 list-none text-muted">
              {status.details.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      )}

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
