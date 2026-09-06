import { getDataStore } from "@/lib/data-access";
import { getSiteConfig } from "@/lib/config";
import { computeResults } from "@/lib/data-access/results";
import { VotingControls } from "@/components/admin/VotingControls";

export const dynamic = "force-dynamic";

export default async function AdminVotingPage() {
  const config = getSiteConfig();
  const store = getDataStore();
  const [status, guests, groups, votes] = await Promise.all([
    store.getVotingStatus(),
    store.getGuests(),
    store.getGroups(),
    store.getVotes(),
  ]);
  const results = computeResults(guests, groups, votes, config.voting.categories);

  const totalEligibleVoters = guests.length;
  const votersWhoVoted = new Set(votes.map((v) => v.voterGuestId)).size;
  const turnoutPercent =
    totalEligibleVoters > 0 ? (votersWhoVoted / totalEligibleVoters) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Voting & Results</h1>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Eligible Voters" value={totalEligibleVoters} />
        <StatCard label="Voters Who Voted" value={votersWhoVoted} />
        <StatCard label="Turnout" value={`${turnoutPercent.toFixed(1)}%`} />
      </div>

      <VotingControls initialStatus={status} initialResults={results} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="surface-panel rounded-lg p-4 text-center">
      <p className="font-heading text-3xl font-bold text-primary">{value}</p>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
