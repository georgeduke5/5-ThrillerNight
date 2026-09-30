import Image from "next/image";
import Link from "next/link";
import { getSiteConfig } from "@/lib/config";

// Matches the shipped placeholder's real pixel dimensions (public/images/
// ThrillerNightLogo.png) — used only to reserve the correct aspect ratio
// before the image loads. A future year's replacement graphic renders at
// its own true proportions once loaded regardless of this ratio; only the
// pre-load layout reservation would be slightly off if it differs a lot.
const LOGO_INTRINSIC_WIDTH = 1000;
const LOGO_INTRINSIC_HEIGHT = 528;

interface EventLogoProps {
  /** Sizing utilities (e.g. a max-width) — height always follows automatically to preserve aspect ratio. */
  className?: string;
  priority?: boolean;
  /**
   * Where the logo links to. Defaults to the public site's "/" for every
   * guest-facing page. The admin layout overrides this to "/admin" (the
   * admin portal's own Home page) so the logo never drops an admin back
   * onto the public site while they're working in the portal.
   */
  href?: string;
}

/**
 * Renders the event's name as an image instead of text, wherever the name
 * would otherwise appear as a heading/label. Swapping in a new year's
 * logo/title graphic is just editing `theme.logoImage` in config and
 * dropping in the new file — the same pattern `theme.backgroundImage`
 * already uses — no component changes required. Alt text always uses the
 * plain-text event name so the name is still available to screen readers
 * and if the image fails to load.
 *
 * Links back to "/" by default — every guest-facing page that renders this
 * gets a clickable way back to the landing page for free, with no per-page
 * wiring. Harmless on the home page itself (clicking just stays on the same
 * page). See the `href` prop above for the admin-portal override.
 */
export function EventLogo({ className, priority, href = "/" }: EventLogoProps) {
  const config = getSiteConfig();
  return (
    <Link href={href} className="inline-block" aria-label={`${config.event.name} — back to home`}>
      <Image
        src={config.theme.logoImage}
        alt={`${config.event.name} logo`}
        width={LOGO_INTRINSIC_WIDTH}
        height={LOGO_INTRINSIC_HEIGHT}
        priority={priority}
        className={`h-auto w-full ${className ?? ""}`}
      />
    </Link>
  );
}
