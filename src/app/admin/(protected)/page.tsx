import Link from "next/link";
import { ADMIN_NAV_ITEMS } from "@/components/admin/adminNavItems";

/**
 * The admin portal's default landing page (POST /api/admin/login redirects
 * here, and /admin with nothing more specific always resolves to this) —
 * a quick-link card for every other page in the admin nav, in the same
 * order the nav lists them. Driven straight off ADMIN_NAV_ITEMS (the same
 * array AdminNav renders) rather than a second hardcoded list, so adding,
 * removing, or reordering a nav page automatically keeps this in sync
 * instead of needing a matching edit here. Home's own entry is skipped —
 * a "Home" card on the Home page would just link to itself.
 */
export default function AdminHomePage() {
  const items = ADMIN_NAV_ITEMS.filter((item) => item.href !== "/admin");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Home</h1>

      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="surface-panel rounded-lg p-4 hover:bg-surface/70">
            <p className="font-heading font-bold uppercase text-text">{item.label}</p>
            <p className="text-sm text-muted">{item.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
