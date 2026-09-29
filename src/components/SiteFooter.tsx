import Link from "next/link";
import { getSiteConfig } from "@/lib/config";

/**
 * Rendered once, from the root layout, so it appears at the bottom of every
 * route — guest-facing pages and the admin panel alike (admin/layout.tsx
 * has no <html>/<body> of its own; it nests inside this same root layout).
 * Kept deliberately minimal: a copyright line and the one link every page
 * is required to carry, to /privacy.
 */
export function SiteFooter() {
  const config = getSiteConfig();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-muted/20 px-6 py-6 text-center">
      <p className="text-sm text-muted">
        © {year} {config.event.name} ·{" "}
        <Link href="/privacy" className="underline hover:text-text">
          Privacy Policy
        </Link>
      </p>
    </footer>
  );
}
