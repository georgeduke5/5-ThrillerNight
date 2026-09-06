import { getDataStore } from "@/lib/data-access";
import { getSiteConfig } from "@/lib/config";
import { GroupManager } from "@/components/admin/GroupManager";

export const dynamic = "force-dynamic";

export default async function AdminGroupsPage() {
  const config = getSiteConfig();
  const store = getDataStore();
  const [groups, guests] = await Promise.all([store.getGroups(), store.getGuests()]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Couple/Group Costumes</h1>
      <GroupManager
        initialGroups={groups}
        guests={guests}
        placeholderImage={config.theme.placeholderImage}
      />
    </div>
  );
}
