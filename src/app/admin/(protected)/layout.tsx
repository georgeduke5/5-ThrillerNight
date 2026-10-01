import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { AdminNav } from "@/components/admin/AdminNav";
import { EventLogo } from "@/components/EventLogo";

/**
 * Admin access has no login screen to redirect to anymore — see
 * adminAccess.ts. Anyone who isn't the currently active, admin-flagged
 * guest is turned away outright to the public home page, never shown a
 * login form or any other hint that a credential could get them in.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await isAdminRequest())) redirect("/");

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 sm:flex-row">
        <AdminNav logo={<EventLogo className="max-w-[8rem]" href="/admin" />} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
