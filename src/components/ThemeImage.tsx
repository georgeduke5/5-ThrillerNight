import Image from "next/image";
import { getSiteConfig } from "@/lib/config";

// Matches the shipped graphic's real aspect ratio (public/images/
// silenceofthelambs.svg, ~132.8 x 47.9) — used only to reserve the correct
// aspect ratio before the image loads. A future year's replacement graphic
// renders at its own true proportions once loaded regardless of this
// ratio; only the pre-load layout reservation would be slightly off if it
// differs a lot.
const THEME_INTRINSIC_WIDTH = 1000;
const THEME_INTRINSIC_HEIGHT = 361;

interface ThemeImageProps {
  /** Sizing utilities (e.g. a max-width) — height always follows automatically to preserve aspect ratio. */
  className?: string;
  priority?: boolean;
}

/**
 * Renders this year's theme-name graphic instead of plain text — the theme
 * name is represented by a custom SVG created fresh each year rather than
 * as text. Swapping in a new year's graphic is just editing
 * `theme.themeImage` in config and dropping in the new file, the same
 * pattern `theme.backgroundImage`/`theme.logoImage` already use — no
 * component changes required. Alt text always uses the plain-text theme
 * name so it's still available to screen readers and if the image fails
 * to load.
 */
export function ThemeImage({ className, priority }: ThemeImageProps) {
  const config = getSiteConfig();
  return (
    <Image
      src={config.theme.themeImage}
      alt={config.event.themeName}
      width={THEME_INTRINSIC_WIDTH}
      height={THEME_INTRINSIC_HEIGHT}
      priority={priority}
      className={`h-auto w-full ${className ?? ""}`}
    />
  );
}
