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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Voting & Results</h1>
      <VotingControls initialStatus={status} initialResults={results} />
    </div>
  );
}
