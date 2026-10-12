import { DangerZoneAction } from "./DangerZoneAction";

/**
 * Destructive admin-only actions for /admin/security, each gated behind
 * DangerZoneAction's in-app type-DELETE-to-confirm dialog — see that file
 * for the shared confirmation UI, and src/app/api/admin/reset-voting-data
 * and /reset-sessions for the server-side routes these call (each
 * independently re-checks isAdminRequest() itself; this component being
 * reachable at all already implies an admin session, since /admin/security
 * sits behind the admin layout's own redirect, but the routes never trust
 * that alone).
 */
export function DangerZone() {
  return (
    <div className="surface-panel flex flex-col gap-4 rounded-lg border border-red-900 p-4">
      <div>
        <h2 className="font-heading text-lg font-bold uppercase text-red-400">Danger Zone</h2>
        <p className="text-sm text-muted">These actions are destructive and cannot be undone.</p>
      </div>

      <DangerZoneAction
        buttonLabel="Remove All Voting & Guessing Data"
        heading="Remove all voting and guessing data?"
        description="This permanently deletes every costume contest vote and every candy count guess. Guests, groups, passkeys, and settings are untouched — guests stay checked in and don't need to re-verify. This cannot be undone."
        endpoint="/api/admin/reset-voting-data"
        kind="reset-voting-data"
      />

      <DangerZoneAction
        buttonLabel="Remove All Login Sessions & Passkey Data"
        heading="Remove all login sessions and passkey data?"
        description="This signs out every non-admin guest on every device, right away, and deletes their registered passkeys — they'll need to verify again (including the on-file-phone code, for whoever has one on file) the next time they check in or vote. Admin accounts, including this one, are not affected. A guest's checked-in or pending-approval status is left exactly as it is — this only resets how they prove who they are, not whether they're already checked in. This cannot be undone."
        endpoint="/api/admin/reset-sessions"
        kind="reset-sessions"
      />
    </div>
  );
}
