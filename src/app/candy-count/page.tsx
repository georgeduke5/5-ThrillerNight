import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getSiteConfig } from "@/lib/config";
import { CandyCountApp } from "@/components/candy-count/CandyCountApp";
import { EventLogo } from "@/components/EventLogo";

export default function CandyCountPage() {
  const config = getSiteConfig();
  if (!config.features.candyCountModuleEnabled) notFound();

  return (
    <main className="hero-background relative min-h-screen px-4 py-10 sm:px-8">
      <div className="fog-layer" />
      <div className="relative z-10 mx-auto max-w-3xl">
        <header className="mb-8 flex flex-col items-center text-center">
          <EventLogo className="max-w-[30rem] sm:max-w-[54rem]" />
          <h1 className="mt-2 font-heading text-4xl font-extrabold uppercase text-text">
            Candy Count
          </h1>
        </header>

        <CandyCountApp placeholderImage={config.theme.placeholderImage} />

        <p className="mt-6 text-center text-sm text-muted">
          Tiebreaker: if two or more guesses are equally close to the actual count, the tie is
          resolved with a live rock-paper-scissors match at the party.
        </p>

        {config.candyCount.prizeImage && (
          <div className="surface-panel mt-10 flex flex-col items-center gap-4 rounded-lg p-6 text-center">
            <p className="font-heading text-2xl font-bold uppercase text-text">
              This is the prize you could win!
            </p>
            <div className="relative h-80 w-full max-w-sm overflow-hidden rounded-lg sm:h-96">
              <Image
                src={config.candyCount.prizeImage}
                alt="Candy count contest prize"
                fill
                className="object-contain"
                unoptimized
              />
            </div>
          </div>
        )}

        <div className="mt-10 flex flex-col items-center gap-2 text-center">
          <Link
            href="/candy-count/results"
            className="inline-block px-2 py-2 text-lg font-bold text-primary underline underline-offset-4 hover:text-primary/80"
          >
            See the winner
          </Link>
        </div>
      </div>
    </main>
  );
}
