import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { isValidId } from "@/lib/validation";
import { VotingApp } from "@/components/voting/VotingApp";

// Live voting status/picks for the target guest, never statically cached.
export const dynamic = "force-dynamic";

/**
 * "Vote for this guest" (see GuestManager.tsx's action of the same name) —
 * an admin-only costume-voting experience for a guest having trouble
 * logging in or voting themselves, reusing VotingApp's own hub/category UI
 * wholesale (see its `adminProxy` prop) rather than a parallel copy of it.
 *
 * isAdminRequest() is re-checked here even though this page already sits
 * under admin/(protected)/layout.tsx, which performs the same check and
 * would already have redirected a non-admin before this component ever
 * ran — deliberately redundant, per the requirement that the target id is
 * only ever honored behind an explicit, independent admin check at every
 * entry point this feature has, this page included, not just the shared
 * layout. See /api/admin/vote-as/[guestId]/route.ts, the other entry
 * point, for the same posture.
 */
export default async function AdminVoteAsPage({ params }: { params: Promise<{ guestId: string }> }) {
  if (!(await isAdminRequest())) redirect("/");

  const { guestId } = await params;
  if (!isValidId(guestId)) notFound();

  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) notFound();

  const guest = await getDataStore().getGuestById(guestId);
  if (!guest) notFound();

  return (
    <div className="flex flex-col gap-6">
      <VotingApp
        categories={config.voting.categories}
        placeholderImage={config.theme.placeholderImage}
        prizeImage={config.voting.prizeImage}
        adminProxy={{ guestId: guest.id, guestName: `${guest.firstName} ${guest.lastName}` }}
      />
    </div>
  );
}
