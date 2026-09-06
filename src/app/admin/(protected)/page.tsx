import Link from "next/link";
import { getDataStore } from "@/lib/data-access";

// Always reads live Sheets data; admin data should never be statically cached.
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const store = getDataStore();
  const [guests, votes, status] = await Promise.all([
    store.getGuests(),
    store.getVotes(),
    store.getVotingStatus(),
  ]);

  const adultMales = guests.filter((g) => g.bracket === "adult-male").length;
  const adultFemales = guests.filter((g) => g.bracket === "adult-female").length;
  const boys = guests.filter((g) => g.bracket === "boy").length;
  const girls = guests.filter((g) => g.bracket === "girl").length;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Guests" value={guests.length} />
        <StatCard label="Adult Male" value={adultMales} />
        <StatCard label="Adult Female" value={adultFemales} />
        <StatCard label="Boys" value={boys} />
        <StatCard label="Girls" value={girls} />
        <StatCard label="Votes cast" value={votes.length} />
      </div>

      <div className="surface-panel rounded-lg p-4">
        <p>
          Voting is currently <strong>{status.isOpen ? "OPEN" : "CLOSED"}</strong>. Results are{" "}
          <strong>{status.resultsPublished ? "PUBLISHED" : "unpublished"}</strong>.
        </p>
        <Link href="/admin/voting" className="mt-2 inline-block text-sm text-primary underline">
          Manage voting status →
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/admin/guests" className="surface-panel rounded-lg p-4 hover:bg-surface/70">
          <p className="font-heading font-bold uppercase text-text">Guests</p>
          <p className="text-sm text-muted">Add/edit guests, photos, and view voted status.</p>
        </Link>
        <Link href="/admin/import" className="surface-panel rounded-lg p-4 hover:bg-surface/70">
          <p className="font-heading font-bold uppercase text-text">Import CSV</p>
          <p className="text-sm text-muted">Bulk-import guests from an Evite export.</p>
        </Link>
        <Link href="/admin/voting" className="surface-panel rounded-lg p-4 hover:bg-surface/70">
          <p className="font-heading font-bold uppercase text-text">Voting & Results</p>
          <p className="text-sm text-muted">Open/close voting and publish results.</p>
        </Link>
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
