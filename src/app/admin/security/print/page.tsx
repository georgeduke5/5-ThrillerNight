import { redirect } from "next/navigation";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { PrintCheckInCode } from "@/components/admin/PrintCheckInCode";

// Same reason as /admin/security itself: this page's QR code carries the
// current party-presence token, which must never be served from a cache.
export const dynamic = "force-dynamic";

/**
 * A printable, admin-only flyer: nothing but a large "Check-In QR Code"
 * heading and the current QR code, reachable only via the "Print" button on
 * /admin/security (see CheckInGate.tsx). Deliberately placed OUTSIDE the
 * admin/(protected) route group — that group's layout.tsx renders the full
 * admin nav/chrome around every other /admin page, which this view must not
 * have — so it re-checks isAdminRequest() itself here instead of inheriting
 * that layout's check, exactly the same admin-only requirement as the rest
 * of /admin, just enforced locally rather than inherited.
 */
export default async function PrintCheckInGatePage() {
  if (!(await isAdminRequest())) redirect("/");

  const token = await getDataStore().getCheckInGateToken();
  return <PrintCheckInCode token={token} />;
}
