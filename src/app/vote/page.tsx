import { notFound } from "next/navigation";
import Image from "next/image";
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
          <EventLogo className="max-w-[30rem] sm:max-w-[54rem]" />
          <h1 className="mt-2 font-heading text-4xl font-extrabold uppercase text-text">
            Costume Voting
          </h1>
        </header>

        <VotingApp
          categories={config.voting.categories}
          placeholderImage={config.theme.placeholderImage}
        />

        {config.voting.prizeImage && (
          <div className="surface-panel mt-10 flex flex-col items-center gap-4 rounded-lg p-6 text-center">
            <p className="font-heading text-2xl font-bold uppercase text-text">
              This is the prize you could win!
            </p>
            <div className="relative h-80 w-full max-w-sm overflow-hidden rounded-lg sm:h-96">
              <Image
                src={config.voting.prizeImage}
                alt="Costume contest prize"
                fill
                // Deliberately NOT unoptimized, unlike the Google-Drive
                // guest/nominee photos elsewhere: this file is local
                // (public/), so Next's built-in optimizer can resize +
                // re-encode it to whatever this ~384px-wide box actually
                // needs, instead of shipping the source file's full
                // resolution/format (the current prize photo is a 4.2MB
                // PNG — a phone-camera-sized file, not something anyone's
                // browser should download in full to show it this small).
                className="object-contain"
                sizes="(min-width: 640px) 24rem, 100vw"
              />
            </div>
          </div>
        )}

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
