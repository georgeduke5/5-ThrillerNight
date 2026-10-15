import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { getDataStore } from "@/lib/data-access";
import { WalkinForm } from "@/components/voting/WalkinForm";
import { HomeLink } from "@/components/HomeLink";
import { isCheckInGateOpenForRequest } from "@/lib/auth/checkInGate";

// Reflects the live admin toggle (VotingStatusToggles "Self-Service Walk-In"),
// not just the static site config — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function WalkinPage() {
  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) notFound();

  const status = await getDataStore().getVotingStatus();
  if (!status.selfServiceWalkinEnabled) notFound();
  // POST /api/guests/walkin enforces this too; checking here just avoids
  // showing a form that can't be submitted.
  const gateOpen = await isCheckInGateOpenForRequest();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-24">
      <HomeLink />
      <h1 className="font-heading text-3xl font-bold uppercase text-text">Add Yourself</h1>
      <p className="text-muted">
        Didn&rsquo;t get an invite through the usual channel? Add your name so you can be
        photographed and voted for tonight.
      </p>
      {gateOpen ? (
        <WalkinForm />
      ) : (
        <p className="surface-panel rounded-lg p-4 text-text">
          Scan tonight&rsquo;s check-in QR code at the party first, then come back here to add
          yourself.
        </p>
      )}
    </main>
  );
}
