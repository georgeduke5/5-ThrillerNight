import { notFound } from "next/navigation";
import Link from "next/link";
import { getSiteConfig } from "@/lib/config";
import { VotingApp } from "@/components/voting/VotingApp";
import { EventLogo } from "@/components/EventLogo";

export default function VotePage() {
  const config = getSiteConfig();
  if (!config.features.votingModuleEnabled) notFound();

  return (
    <main className="hero-background relative min-h-screen px-4 pb-10 sm:px-8">
      <div className="fog-layer" />
      <div className="relative z-10 mx-auto max-w-3xl">
        <VotingApp
          categories={config.voting.categories}
          placeholderImage={config.theme.placeholderImage}
          prizeImage={config.voting.prizeImage}
          logo={
            <header className="mb-2 flex flex-col items-center text-center">
              <EventLogo className="max-w-[9rem] sm:max-w-[12rem]" />
            </header>
          }
        />

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
