import { DangerZoneAction } from "./DangerZoneAction";

/**
 * Destructive admin-only actions for /admin/security, each gated behind
 * DangerZoneAction's in-app type-DELETE-to-confirm dialog — see that file
 * for the shared confirmation UI, and src/app/api/admin/reset-voting-data,
 * /reset-sessions, and /reset-to-admins-only for the server-side routes
 * these call (each independently re-checks isAdminRequest() itself; this
 * component being reachable at all already implies an admin session, since
 * /admin/security sits behind the admin layout's own redirect, but the
 * routes never trust that alone).
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
        description="This signs out every non-admin guest on every device, right away, and deletes their registered passkeys — they'll need to verify again (including the on-file-phone code, for whoever has one on file) the next time they check in or vote. Admin accounts, including this one, are not affected. Every guest whose passkey is deleted goes back to pending approval, so each one will need you to approve them again (matching the code on their waiting screen) after they re-register. This cannot be undone."
        endpoint="/api/admin/reset-sessions"
        kind="reset-sessions"
      />

      <DangerZoneAction
        buttonLabel="Reset to Admins Only"
        heading="Reset to admins only?"
        description="This deletes every guest except the ones marked as admins in the Guests sheet (isAdmin = true), along with their photos — a full reset back to a clean, pre-party state. It also permanently deletes all votes and all candy-count guesses (admins' included), every non-admin passkey, deletes every group with no admin left in it, removes deleted guests from the rest, and signs out every login session on every device, admins included, so you'll be signed out immediately as well. Admins keep their passkeys, so you can sign straight back in. Voting, walk-ins, and other changes are paused while it runs. Party settings (including the check-in link) are untouched. If it's interrupted, you'll see what was and wasn't deleted, and running it again finishes the rest. This cannot be undone."
        endpoint="/api/admin/reset-to-admins-only"
        kind="reset-to-admins-only"
      />
    </div>
  );
}
