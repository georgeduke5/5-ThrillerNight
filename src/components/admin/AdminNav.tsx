"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";
import { ADMIN_NAV_ITEMS } from "@/components/admin/adminNavItems";

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

/**
 * Admin section nav. Was a flat row of link pills that wrapped across
 * several lines on a phone once enough admin sections existed — replaced
 * with a persistent sidebar on desktop (unchanged visually from before) and
 * a single-row hamburger toggle on mobile, so a phone screen always shows
 * exactly one clear "where am I / where can I go" control instead of a
 * multi-line pill grid competing with the page content below it.
 *
 * `logo` is rendered server-side by the parent layout (a Server Component)
 * and passed down as already-rendered JSX — EventLogo itself calls
 * server-only getSiteConfig(), so it can never be imported directly into
 * this "use client" module.
 */
export function AdminNav({ logo }: { logo: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = ADMIN_NAV_ITEMS.find((item) => isActive(pathname, item.href));

  return (
    <>
      <div className="flex items-center justify-between gap-3 sm:hidden">
        {logo}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="admin-mobile-nav"
          className="flex items-center gap-2 rounded border border-muted/40 px-3 py-2 text-sm text-text"
        >
          <span className="max-w-[9rem] truncate">{current?.label ?? "Menu"}</span>
          <span aria-hidden="true">{open ? "✕" : "☰"}</span>
        </button>
      </div>
      {open && (
        <nav
          id="admin-mobile-nav"
          className="flex flex-col gap-1 rounded-lg border border-muted/20 bg-surface p-2 sm:hidden"
        >
          {ADMIN_NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`rounded px-3 py-2 text-sm ${
                isActive(pathname, item.href) ? "bg-primary font-bold text-bg" : "text-text hover:bg-bg"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <AdminLogoutButton />
        </nav>
      )}

      <nav className="hidden gap-2 sm:flex sm:w-48 sm:flex-col">
        <div className="mb-2">{logo}</div>
        {ADMIN_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded px-3 py-2 text-sm ${
              isActive(pathname, item.href) ? "bg-primary font-bold text-bg" : "hover:bg-surface"
            }`}
          >
            {item.label}
          </Link>
        ))}
        <AdminLogoutButton />
      </nav>
    </>
  );
}
