import type { SiteConfig } from "./types";

/**
 * Turns config theme values into CSS custom properties. Tailwind classes
 * (see tailwind.config.ts) reference these variables by name, so re-theming
 * the whole site is just editing config/site.config.json + swapping the
 * image file at that path — no component ever hardcodes a color or font.
 */
export function themeCssVariables(config: SiteConfig): string {
  const { colors, fonts, backgroundImage, backgroundSize } = config.theme;
  return [
    `--color-bg: ${colors.bg};`,
    `--color-surface: ${colors.surface};`,
    `--color-primary: ${colors.primary};`,
    `--color-accent: ${colors.accent};`,
    `--color-text: ${colors.text};`,
    `--color-muted: ${colors.muted};`,
    `--font-heading: ${fonts.heading};`,
    `--font-body: ${fonts.body};`,
    `--image-background: url('${backgroundImage}');`,
    `--background-size: ${backgroundSize};`,
  ].join("\n");
}
