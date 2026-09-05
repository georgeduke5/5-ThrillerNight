import { getDataStore } from "@/lib/data-access";
import { PhotoUploader } from "@/components/admin/PhotoUploader";

export const dynamic = "force-dynamic";

export default async function AdminPhotosPage() {
  const store = getDataStore();
  const [guests, groups] = await Promise.all([store.getGuests(), store.getGroups()]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold uppercase">Costume Photos</h1>
      {guests.length === 0 ? (
        <p className="text-muted">Add guests first, then come back here to tag their photos.</p>
      ) : (
        <PhotoUploader initialGuests={guests} initialGroups={groups} />
      )}
    </div>
  );
}
