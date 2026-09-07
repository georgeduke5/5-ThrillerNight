import { getSiteConfig } from "@/lib/config";
import { CtaButton } from "@/components/CtaButton";
import { EventLogo } from "@/components/EventLogo";
import { ThemeImage } from "@/components/ThemeImage";
import { CheckInButton } from "@/components/CheckInButton";

export default function HomePage() {
  const config = getSiteConfig();
  const { invitationModuleEnabled, votingModuleEnabled } = config.features;

  return (
    <main className="hero-background relative flex min-h-screen items-center justify-center px-6 py-24">
      <div className="fog-layer" />
      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-6 text-center">
        <EventLogo className="max-w-xs sm:max-w-lg" priority />
        <ThemeImage className="max-w-[14rem] sm:max-w-xs" />

        <p className="text-xl font-semibold text-text sm:text-2xl">{config.event.tagline}</p>

        <div className="mt-6 flex flex-row flex-wrap items-center justify-center gap-4">
          {votingModuleEnabled && <CheckInButton />}
          {votingModuleEnabled && <CtaButton href="/vote">Vote</CtaButton>}
          {invitationModuleEnabled && (
            <CtaButton href="/invite" variant="accent">
              RSVP Now
            </CtaButton>
          )}
        </div>

        {!invitationModuleEnabled && (
          <p className="mt-2 text-sm text-muted">Invitations for this year went out separately.</p>
        )}
      </div>
    </main>
  );
}
