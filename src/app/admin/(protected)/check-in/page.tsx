import { getDataStore } from "@/lib/data-access";
import { CheckInManager } from "@/components/admin/CheckInManager";
import { getPendingApprovalCode } from "@/lib/auth/pendingApprovalCode";

// Always reads live Sheets data; admin data should never be statically cached.
export const dynamic = "force-dynamic";

export default async function AdminCheckInPage() {
  const guests = await getDataStore().getGuests();
  const pendingGuests = guests
    .filter((g) => g.pendingApprovalAt !== null)
    .sort((a, b) => (a.pendingApprovalAt ?? "").localeCompare(b.pendingApprovalAt ?? ""))
    .map((g) => ({ guest: g, code: getPendingApprovalCode(g) ?? "" }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Check-In</h1>
      <p className="text-sm text-muted">
        Guests who couldn&rsquo;t verify with a passkey or phone code land here instead of being
        checked in automatically: a passkey registered with no phone on file, or a tap on
        &ldquo;Check in with an admin.&rdquo; Approve confirms their identity; Reject clears their
        registration so the real guest can register from scratch.
      </p>
      <div className="surface-panel rounded-lg border border-primary/40 p-4 text-sm text-text">
        <p className="font-heading font-bold uppercase">Match the code before you approve</p>
        <p className="mt-1 text-muted">
          Ask the guest to show you their waiting screen. Approve only if the code on their phone
          matches the code next to their name here. Approving unlocks the device that filed the
          request, not the person standing in front of you, so anyone could have filed a request
          under someone else&rsquo;s name. If the codes don&rsquo;t match (or they have no waiting
          screen), reject the request and have them check in again on their own phone.
        </p>
      </div>
      <CheckInManager initialPending={pendingGuests} />
    </div>
  );
}
