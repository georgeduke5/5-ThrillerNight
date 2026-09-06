import { getDataStore } from "@/lib/data-access";
import { getSiteConfig } from "@/lib/config";
import { GuestManager } from "@/components/admin/GuestManager";

export const dynamic = "force-dynamic";

export default async function AdminGuestsPage() {
  const config = getSiteConfig();
  const store = getDataStore();
  const [guests, votes] = await Promise.all([store.getGuests(), store.getVotes()]);
  const votedGuestIds = [...new Set(votes.map((v) => v.voterGuestId))];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Guest / Nominee List</h1>
      <GuestManager
        initialGuests={guests}
        votedGuestIds={votedGuestIds}
        placeholderImage={config.theme.placeholderImage}
      />
    </div>
  );
}
