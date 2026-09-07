import { notFound } from "next/navigation";
import { getSiteConfig } from "@/lib/config";
import { getDataStore } from "@/lib/data-access";
import { WalkinForm } from "@/components/voting/WalkinForm";

// Reflects the live admin toggle (VotingControls "Self-Service Walk-In"),
// not just the static site config — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function WalkinPage() {
  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) notFound();

  const status = await getDataStore().getVotingStatus();
  if (!status.selfServiceWalkinEnabled) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-24">
      <h1 className="font-heading text-3xl font-bold uppercase text-text">Add Yourself</h1>
      <p className="text-muted">
        Didn&rsquo;t get an invite through the usual channel? Add your name so you can be
        photographed and voted for tonight.
      </p>
      <WalkinForm />
    </main>
  );
}
