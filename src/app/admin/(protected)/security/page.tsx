import { getDataStore } from "@/lib/data-access";
import { SecurityToggles } from "@/components/admin/SecurityToggles";
import { CheckInGate } from "@/components/admin/CheckInGate";
import { MigratePhoneEncryptionButton } from "@/components/admin/MigratePhoneEncryptionButton";
import { DangerZone } from "@/components/admin/DangerZone";

// Always reads live Sheets data, never statically cached — this page's QR
// code carries the current party-presence token, which must never be
// served from a cache (see CheckInGate.tsx).
export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  const store = getDataStore();
  const [guests, status, checkInGateToken] = await Promise.all([
    store.getGuests(),
    store.getVotingStatus(),
    store.getCheckInGateToken(),
  ]);

  const adultMales = guests.filter((g) => g.bracket === "adult-male").length;
  const adultFemales = guests.filter((g) => g.bracket === "adult-female").length;
  const boys = guests.filter((g) => g.bracket === "boy").length;
  const girls = guests.filter((g) => g.bracket === "girl").length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Security</h1>

      <SecurityToggles initialStatus={status} />

      <CheckInGate initialToken={checkInGateToken} />

      <MigratePhoneEncryptionButton />

      <DangerZone />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Guests" value={guests.length} />
        <StatCard label="Adult Male" value={adultMales} />
        <StatCard label="Adult Female" value={adultFemales} />
        <StatCard label="Boys" value={boys} />
        <StatCard label="Girls" value={girls} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-panel rounded-lg p-4 text-center">
      <p className="font-heading text-3xl font-bold text-primary">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
