import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Wraps every /admin/* route (both /admin/login and everything under the
 * (protected) group) purely to attach noindex metadata — belt-and-suspenders
 * alongside the auth gate and robots.txt's /admin disallow rule. No UI of
 * its own; (protected)/layout.tsx still owns the actual admin chrome.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return children;
}
