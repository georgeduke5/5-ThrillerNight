import { getSiteConfig } from "@/lib/config";
import { BackgroundPreload } from "@/components/BackgroundPreload";
import { CtaButton } from "@/components/CtaButton";
import { EventLogo } from "@/components/EventLogo";
import { ThemeImage } from "@/components/ThemeImage";
import { HomeNavButtons, type NavButtonConfig } from "@/components/HomeNavButtons";

export default function HomePage() {
  const config = getSiteConfig();
  const { invitationModuleEnabled, votingModuleEnabled, candyCountModuleEnabled } = config.features;

  // Every feature entry point below Check-In, in display order. Adding a
  // future year's feature (e.g. trivia) is just adding one more conditional
  // entry here — no layout changes needed.
  const navButtons: NavButtonConfig[] = [
    ...(votingModuleEnabled ? [{ href: "/vote", label: "Costume Contest" }] : []),
    ...(candyCountModuleEnabled ? [{ href: "/candy-count", label: "Candy Count" }] : []),
  ];

  return (
    <main className="hero-background relative flex min-h-screen items-start justify-center px-6 pb-16 pt-64">
      <BackgroundPreload />
      <div className="fog-layer" />
      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-6 text-center">
        <EventLogo className="max-w-xs sm:max-w-lg" priority />
        {/*
        <ThemeImage className="max-w-[14rem] sm:max-w-xs" />

        <p className="text-xl font-semibold text-text sm:text-2xl">{config.event.tagline}</p>
        */}
        <div className="mt-6 flex flex-col items-center gap-4">
          <HomeNavButtons placeholderImage={config.theme.placeholderImage} navButtons={navButtons} />
          {invitationModuleEnabled && (
            <CtaButton href="/invite" variant="accent">
              RSVP Now
            </CtaButton>
          )}
        </div>
        {/*}
        {!invitationModuleEnabled && (
          <p className="mt-2 text-sm text-muted">Invitations for this year went out separately.</p>
        )}
          */}
      </div>
    </main>
  );
}
