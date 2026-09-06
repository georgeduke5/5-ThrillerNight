import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { SiteConfig, VotingCategory } from "./types";

/**
 * Runtime configuration loader.
 *
 * Precedence (highest wins): environment variables > config/site.config.json
 * (gitignored, filled in per-deployment) > config/site.config.example.json
 * (committed placeholders, used so the app still runs on a fresh clone).
 *
 * Nothing event-specific is ever hardcoded here — this module only knows
 * *how* to assemble config, not what this year's values are.
 */

const CONFIG_DIR = path.join(process.cwd(), "config");

function readJsonIfExists(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.trim().toLowerCase() === "true";
}

function deepGet<T>(obj: unknown, keyPath: string[]): T | undefined {
  let cur: unknown = obj;
  for (const key of keyPath) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur as T | undefined;
}

let cachedConfig: SiteConfig | null = null;

export function getSiteConfig(): SiteConfig {
  if (cachedConfig) return cachedConfig;

  const fileConfig =
    readJsonIfExists(path.join(CONFIG_DIR, "site.config.json")) ??
    readJsonIfExists(path.join(CONFIG_DIR, "site.config.example.json")) ??
    {};

  const g = <T>(keyPath: string) => deepGet<T>(fileConfig, keyPath.split("."));

  const categoriesFromFile = g<VotingCategory[]>("voting.categories") ?? [];

  const config: SiteConfig = {
    event: {
      name: process.env.SITE_EVENT_NAME ?? g<string>("event.name") ?? "Thriller Night",
      themeName:
        process.env.SITE_EVENT_THEME_NAME ?? g<string>("event.themeName") ?? "This Year's Theme",
      date: process.env.SITE_EVENT_DATE ?? g<string>("event.date") ?? "",
      arrivalTime: process.env.SITE_EVENT_ARRIVAL_TIME ?? g<string>("event.arrivalTime") ?? "",
      endTime: process.env.SITE_EVENT_END_TIME ?? g<string>("event.endTime") ?? "",
      tagline:
        process.env.SITE_EVENT_TAGLINE ?? g<string>("event.tagline") ?? "Everyone wears a costume.",
    },
    features: {
      invitationModuleEnabled: parseBool(
        process.env.SITE_INVITATION_MODULE_ENABLED,
        g<boolean>("features.invitationModuleEnabled") ?? false,
      ),
      votingModuleEnabled: parseBool(
        process.env.SITE_VOTING_MODULE_ENABLED,
        g<boolean>("features.votingModuleEnabled") ?? true,
      ),
    },
    theme: {
      colors: {
        bg: process.env.SITE_COLOR_BG ?? g<string>("theme.colors.bg") ?? "#0a0a0a",
        surface: process.env.SITE_COLOR_SURFACE ?? g<string>("theme.colors.surface") ?? "#161414",
        primary: process.env.SITE_COLOR_PRIMARY ?? g<string>("theme.colors.primary") ?? "#ff6a00",
        accent: process.env.SITE_COLOR_ACCENT ?? g<string>("theme.colors.accent") ?? "#035575",
        text: process.env.SITE_COLOR_TEXT ?? g<string>("theme.colors.text") ?? "#f5f5f5",
        muted: process.env.SITE_COLOR_MUTED ?? g<string>("theme.colors.muted") ?? "#a3a3a3",
      },
      fonts: {
        heading:
          process.env.SITE_FONT_HEADING ??
          g<string>("theme.fonts.heading") ??
          "Arial, Helvetica, sans-serif",
        body:
          process.env.SITE_FONT_BODY ??
          g<string>("theme.fonts.body") ??
          "Arial, Helvetica, sans-serif",
      },
      backgroundImage:
        process.env.SITE_BACKGROUND_IMAGE ??
        g<string>("theme.backgroundImage") ??
        "/images/background.jpg",
      backgroundSize:
        process.env.SITE_BACKGROUND_SIZE ?? g<string>("theme.backgroundSize") ?? "contain",
      logoImage:
        process.env.SITE_LOGO_IMAGE ?? g<string>("theme.logoImage") ?? "/images/logo.png",
      themeImage:
        process.env.SITE_THEME_IMAGE ?? g<string>("theme.themeImage") ?? "/images/theme.svg",
      placeholderImage:
        process.env.SITE_PLACEHOLDER_IMAGE ??
        g<string>("theme.placeholderImage") ??
        "/images/no-photo.svg",
    },
    voting: {
      categories: categoriesFromFile.length > 0 ? categoriesFromFile : defaultCategories(),
    },
  };

  cachedConfig = config;
  return config;
}

function defaultCategories(): VotingCategory[] {
  return [
    { id: "best-adult-male-costume", label: "Best Adult Male Costume", bracket: "adult-male" },
    { id: "best-adult-female-costume", label: "Best Adult Female Costume", bracket: "adult-female" },
    { id: "best-boy-costume", label: "Best Boy Costume", bracket: "boy" },
    { id: "best-girl-costume", label: "Best Girl Costume", bracket: "girl" },
    {
      id: "best-couple-group-costume",
      label: "Best Couple/Group Costume",
      bracket: null,
      nomineeType: "group",
    },
  ];
}

/** Test-only escape hatch; production code should never need this. */
export function _resetConfigCacheForTests(): void {
  cachedConfig = null;
}

export type { SiteConfig, VotingCategory, GuestBracket } from "./types";
