"use client";

import { useRouter } from "next/navigation";

export function AdminLogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
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
