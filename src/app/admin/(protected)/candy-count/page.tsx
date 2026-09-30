import { getDataStore } from "@/lib/data-access";
import { computeCandyResults } from "@/lib/data-access/candyResults";
import { CandyCountStatusToggles } from "@/components/admin/CandyCountStatusToggles";
import { CandyCountResultsPanel } from "@/components/admin/CandyCountResultsPanel";

export const dynamic = "force-dynamic";

/**
 * Candy Count contest admin page — deliberately separate from
 * /admin/voting, not merged into it, since this is a genuinely separate
 * contest with its own toggles and its own results. Mirrors that page's
 * structure (stat cards, status toggles, live results) exactly.
 */
export default async function AdminCandyCountPage() {
  const store = getDataStore();
  const [status, guesses, guests] = await Promise.all([
    store.getCandyCountStatus(),
    store.getCandyGuesses(),
    store.getGuests(),
  ]);

  const results = status.trueCount !== null ? computeCandyResults(guesses, guests, status.trueCount) : null;
  const participationPercent = guests.length > 0 ? (guesses.length / guests.length) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Candy Count Contest</h1>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Eligible Guests" value={guests.length} />
        <StatCard label="Guesses Submitted" value={guesses.length} />
        <StatCard label="Participation" value={`${participationPercent.toFixed(1)}%`} />
      </div>

      <CandyCountStatusToggles initialStatus={status} />

      <CandyCountResultsPanel initialResults={results} />
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
