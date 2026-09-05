import { getDataStore } from "@/lib/data-access";
import { GuestManager } from "@/components/admin/GuestManager";

export const dynamic = "force-dynamic";

export default async function AdminGuestsPage() {
  const guests = await getDataStore().getGuests();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Guest / Nominee List</h1>
      <GuestManager initialGuests={guests} />
    </div>
  );
}
