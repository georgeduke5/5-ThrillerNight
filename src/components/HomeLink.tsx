import Link from "next/link";

/**
 * Explicit "back to Home" affordance, fixed to the upper-left corner of
 * every guest-facing page except the homepage itself (which doesn't need
 * a link to itself) and every admin page (which has its own nav via
 * EventLogo's href="/admin" override and the admin layout's own chrome —
 * see src/app/admin/layout.tsx). There's no shared layout covering just
 * "guest pages, not the homepage," so this is dropped into each of those
 * page.tsx files individually rather than live in a layout.
 *
 * `fixed` (not `absolute`) so it stays in the same corner regardless of
 * each page's own scroll position, and renders above that page's own
 * content (z-20) without competing with modals (which use z-50, e.g.
 * VerifyIdentityModal) or the decorative .fog-layer. Colors come from the
 * same theme tokens (surface/text/primary) every other themed element
 * uses — nothing hardcoded — so it re-themes automatically with the rest
 * of the site.
 */
export function HomeLink() {
  return (
    <Link
      href="/"
      className="fixed left-3 top-3 z-20 rounded-full bg-surface/80 px-4 py-2 font-heading text-base font-bold uppercase text-text shadow-lg backdrop-blur transition-colors hover:text-primary sm:left-4 sm:top-4"
    >
      <span aria-hidden="true">←</span> Home
    </Link>
  );
}
