import { getDataStore } from "@/lib/data-access";
import { getSiteConfig } from "@/lib/config";
import { GuestManager } from "@/components/admin/GuestManager";

export const dynamic = "force-dynamic";

export default async function AdminGuestsPage() {
  const config = getSiteConfig();
  const store = getDataStore();
  const [guests, votes, passkeys] = await Promise.all([store.getGuests(), store.getVotes(), store.getPasskeys()]);
  const votedGuestIds = [...new Set(votes.map((v) => v.voterGuestId))];
  const guestIdsWithPasskey = new Set(passkeys.map((p) => p.guestId));
  const guestsWithPasskeyFlag = guests.map((g) => ({ ...g, hasPasskey: guestIdsWithPasskey.has(g.id) }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Guest / Nominee List</h1>
      <GuestManager
        initialGuests={guestsWithPasskeyFlag}
        votedGuestIds={votedGuestIds}
        placeholderImage={config.theme.placeholderImage}
      />
    </div>
  );
}
