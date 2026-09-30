import { getDataStore } from "@/lib/data-access";
import { CheckInManager } from "@/components/admin/CheckInManager";

// Always reads live Sheets data; admin data should never be statically cached.
export const dynamic = "force-dynamic";

export default async function AdminCheckInPage() {
  const guests = await getDataStore().getGuests();
  const pendingGuests = guests
    .filter((g) => g.pendingApprovalAt !== null)
    .sort((a, b) => (a.pendingApprovalAt ?? "").localeCompare(b.pendingApprovalAt ?? ""));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Check-In</h1>
      <p className="text-sm text-muted">
        Guests who registered a passkey without phone verification (no phone on file) land here
        instead of being checked in automatically. Approve confirms their identity; Reject clears
        their registration so the real guest can register from scratch.
      </p>
      <CheckInManager initialPendingGuests={pendingGuests} />
    </div>
  );
}
