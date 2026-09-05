import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { isAdminRequest } from "@/lib/auth/adminSession";
import { AdminLogoutButton } from "@/components/admin/AdminLogoutButton";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/guests", label: "Guests" },
  { href: "/admin/groups", label: "Groups" },
  { href: "/admin/import", label: "Import CSV" },
  { href: "/admin/photos", label: "Photos" },
  { href: "/admin/voting", label: "Voting & Results" },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await isAdminRequest())) redirect("/admin/login");

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 sm:flex-row">
        <nav className="flex flex-row flex-wrap gap-2 sm:w-48 sm:flex-col">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-3 py-2 text-sm hover:bg-surface"
            >
              {item.label}
            </Link>
          ))}
          <AdminLogoutButton />
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
