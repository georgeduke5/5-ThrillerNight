import { getSiteConfig } from "@/lib/config";
import { CtaButton } from "@/components/CtaButton";
import { EventLogo } from "@/components/EventLogo";

function formatEventLine(config: ReturnType<typeof getSiteConfig>): string | null {
  const { date, arrivalTime, endTime } = config.event;
  const parts: string[] = [];
  if (date) {
    parts.push(
      new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    );
  }
  if (arrivalTime && endTime) parts.push(`${arrivalTime} – ${endTime}`);
  else if (arrivalTime) parts.push(`Arrive ${arrivalTime}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default function HomePage() {
  const config = getSiteConfig();
  const eventLine = formatEventLine(config);
  const { invitationModuleEnabled, votingModuleEnabled } = config.features;

  return (
    <main className="hero-background relative flex min-h-screen items-center justify-center px-6 py-24">
      <div className="fog-layer" />
      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-6 text-center">
        <p className="font-heading text-sm font-bold uppercase tracking-[0.3em] text-muted">
          {config.event.themeName}
        </p>
        <EventLogo className="max-w-xs sm:max-w-lg" priority />
        {eventLine && <p className="text-lg text-muted sm:text-xl">{eventLine}</p>}
        <p className="text-xl font-semibold text-text sm:text-2xl">{config.event.tagline}</p>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row">
          {votingModuleEnabled && <CtaButton href="/vote">Cast Your Vote</CtaButton>}
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
