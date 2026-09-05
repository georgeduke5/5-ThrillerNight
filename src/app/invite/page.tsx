import { notFound } from "next/navigation";
import Link from "next/link";
import { getSiteConfig } from "@/lib/config";
import { EventLogo } from "@/components/EventLogo";

/**
 * Phase 1 stub landing page (requirements Section 6.1). Full scope
 * (Section 6.2: event info, "everyone wears a costume" messaging, RSVP CTA)
 * is deferred to Phase 2. This page proves the invitationModuleEnabled
 * toggle and the module's folder structure; when the toggle is off it 404s
 * rather than rendering a partial/broken page.
 */
export default function InviteLandingPage() {
  const config = getSiteConfig();
  if (!config.features.invitationModuleEnabled) notFound();

  return (
    <main className="hero-background relative flex min-h-screen items-center justify-center px-6 py-24">
      <div className="fog-layer" />
      <div className="relative z-10 max-w-xl text-center text-text">
        <EventLogo className="mx-auto max-w-xs sm:max-w-sm" priority />
        <p className="mt-4 text-muted">
          Phase 1 placeholder for the full invitation / RSVP landing page. The complete experience
          (event details, costume-required messaging, RSVP call-to-action) is Phase 2 scope — see
          Section 6.2 of the requirements document.
        </p>
        <Link
          href="/invite/rsvp"
          className="mt-8 inline-block rounded-md bg-primary px-6 py-3 font-heading font-bold uppercase text-bg"
        >
          RSVP (stub)
        </Link>
      </div>
    </main>
  );
}
