import { redirect } from "next/navigation";
import { getDataStore } from "@/lib/data-access";
import { getSessionGuestId } from "@/lib/auth/voterSession";
import { getPendingApprovalCode } from "@/lib/auth/pendingApprovalCode";
import { BackgroundPreload } from "@/components/BackgroundPreload";
import { EventLogo } from "@/components/EventLogo";
import { HomeLink } from "@/components/HomeLink";

/**
 * The single screen a pending guest is allowed to see — see src/proxy.ts,
 * which redirects every other gated page here for as long as
 * Guest.pendingApprovalAt is set. Falls through to the home page for anyone
 * else (no session, or already approved) rather than rendering a stale
 * "you're checked in" message to someone who isn't actually in this state.
 * Reloading this page is also how a guest finds out they've been approved:
 * this redirect re-evaluates their status fresh on every load, same as
 * every other gate in this app.
 *
 * Shows the request's verification code (see pendingApprovalCode.ts) so the
 * admin can confirm this is the device that filed the request before
 * approving it.
 */
export default async function CheckInPendingPage() {
  const guestId = await getSessionGuestId();
  const guest = guestId ? await getDataStore().getGuestById(guestId) : null;
  if (!guest?.pendingApprovalAt) redirect("/");
  const code = getPendingApprovalCode(guest);

  return (
    <main className="hero-background relative flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <BackgroundPreload />
      <HomeLink />
      <div className="fog-layer" />
      <div className="surface-panel relative z-10 flex max-w-md flex-col gap-4 rounded-lg p-8">
        <EventLogo className="mx-auto max-w-[16rem]" />
        <h1 className="font-heading text-2xl font-bold uppercase text-text">You&rsquo;re checked in!</h1>
        <p className="text-muted">
          Please find George or Sarah and show them this screen. They&rsquo;ll check that this code
          matches before approving you, then come back here.
        </p>
        <p className="text-sm uppercase text-muted">
          {guest.firstName} {guest.lastName}
        </p>
        <p
          aria-label="Your check-in code"
          className="font-heading text-5xl font-bold tracking-[0.3em] text-primary"
        >
          {code}
        </p>
      </div>
    </main>
  );
}
