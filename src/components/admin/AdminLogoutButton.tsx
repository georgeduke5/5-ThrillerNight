"use client";

import { useRouter } from "next/navigation";

/**
 * There's no separate "admin session" to sign out of anymore — admin access
 * is just whatever the browser's active checked-in guest is flagged as (see
 * adminAccess.ts). "Log out" here means ending that check-in entirely:
 * POST /api/auth/phone/logout clears the whole voter-session cookie (every
 * guest identity verified on this browser, not just the active one), then
 * sends them back to the public site.
 */
export function AdminLogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/phone/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="mt-4 rounded px-3 py-2 text-left text-sm text-muted hover:bg-surface sm:mt-auto"
    >
      Log out
    </button>
  );
}
