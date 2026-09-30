import Link from "next/link";

/**
 * The admin portal's default landing page (POST /api/admin/login redirects
 * here, and /admin with nothing more specific always resolves to this) —
 * just the quick-link grid that used to sit at the bottom of the Security
 * page, now the first thing an admin sees rather than buried under stat
 * cards and toggles that aren't relevant every visit.
 */
export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Home</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/check-in" className="surface-panel rounded-lg p-4 hover:bg-surface/70">
          <p className="font-heading font-bold uppercase text-text">Check-In</p>
          <p className="text-sm text-muted">
            Approve or clear guests awaiting review after a no-phone passkey registration.
          </p>
        </Link>
        <Link href="/admin/guests" className="surface-panel rounded-lg p-4 hover:bg-surface/70">
          <p className="font-heading font-bold uppercase text-text">Guests</p>
          <p className="text-sm text-muted">Add/edit guests, photos, and view voted status.</p>
        </Link>
        <Link href="/admin/import" className="surface-panel rounded-lg p-4 hover:bg-surface/70">
          <p className="font-heading font-bold uppercase text-text">Import CSV</p>
          <p className="text-sm text-muted">Bulk-import guests from an Evite export.</p>
        </Link>
        <Link href="/admin/voting" className="surface-panel rounded-lg p-4 hover:bg-surface/70">
          <p className="font-heading font-bold uppercase text-text">Costume Contest</p>
          <p className="text-sm text-muted">View turnout stats and live results by category.</p>
        </Link>
        <Link href="/admin/candy-count" className="surface-panel rounded-lg p-4 hover:bg-surface/70">
          <p className="font-heading font-bold uppercase text-text">Candy Count</p>
          <p className="text-sm text-muted">Open/close guessing, enter the true count, and view standings.</p>
        </Link>
      </div>
    </div>
  );
}
