import { notFound } from "next/navigation";
import Link from "next/link";
import { getSiteConfig } from "@/lib/config";
import { VotingApp } from "@/components/voting/VotingApp";
import { EventLogo } from "@/components/EventLogo";

export default function VotePage() {
  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) notFound();

  return (
    <main className="hero-background relative min-h-screen px-4 py-10 sm:px-8">
      <div className="fog-layer" />
      <div className="relative z-10 mx-auto max-w-3xl">
        <header className="mb-8 flex flex-col items-center text-center">
          <EventLogo className="max-w-[10rem] sm:max-w-[14rem]" />
          <h1 className="mt-2 font-heading text-4xl font-extrabold uppercase text-text">
            Costume Voting
          </h1>
        </header>

        <VotingApp categories={config.voting.categories} />

        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <Link href="/vote/walkin" className="text-sm text-muted underline hover:text-text">
            Didn&rsquo;t RSVP? Add yourself as a walk-in guest
          </Link>
          <Link href="/vote/results" className="text-sm text-muted underline hover:text-text">
            See the winners
          </Link>
        </div>
      </div>
    </main>
  );
}
