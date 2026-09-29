export type GuestBracket = "adult-male" | "adult-female" | "boy" | "girl";

export interface VotingCategory {
  /** Stable slug used in URLs, votes, and the Sheets "Votes" tab. */
  id: string;
  /** Display label, e.g. "Best Boy Costume". */
  label: string;
  /**
   * Which guest bracket is eligible to be nominated in this category.
   * Ignored (should be `null`) when `nomineeType` is `"group"`.
   */
  bracket: GuestBracket | null;
  /**
   * Whether nominees for this category are individual guests filtered by
   * `bracket` (`"guest"`, the default) or Group records (`"group"`) — e.g.
   * the Couple/Group category nominates groups as a single unit rather than
   * their individual members. Optional and defaults to `"guest"` for
   * backward compatibility with existing site.config.json files; read
   * everywhere as `category.nomineeType ?? "guest"`.
   */
  nomineeType?: "guest" | "group";
}

export interface SiteConfig {
  event: {
    name: string;
    themeName: string;
    /** ISO date string, e.g. "2026-10-31". */
    date: string;
    arrivalTime: string;
    endTime: string;
    tagline: string;
  };
  features: {
    invitationModuleEnabled: boolean;
    votingModuleEnabled: boolean;
  };
  auth: {
    /**
     * WebAuthn relying-party settings for the passkey login flow. Only read
     * when the admin's `passkeyAuthEnabled` switch is on (that lives in the
     * Sheets-backed VotingStatus, not here, since it's toggled at runtime
     * from the admin dashboard).
     */
    passkey: {
      /** Human-readable name shown by the OS/browser passkey prompt. */
      rpName: string;
      /**
       * The relying-party id: the registrable domain, with no scheme or
       * port ("localhost", "thriller-night.vercel.app"). A passkey is bound
       * to this value forever, so changing it after guests have registered
       * invalidates their credentials. Leave blank to derive it from each
       * request's own hostname, which is what makes one deployment work
       * unchanged across local dev and the production domain.
       */
      rpId: string;
      /**
       * Full origins (scheme + host + port) a ceremony may be completed
       * from, e.g. ["http://localhost:3001", "https://thriller-night.vercel.app"].
       * Listing both lets the same config verify dev and production without
       * a redeploy. Leave empty to accept only the request's own origin.
       */
      origins: string[];
    };
  };
  theme: {
    colors: {
      bg: string;
      surface: string;
      primary: string;
      accent: string;
      text: string;
      muted: string;
    };
    fonts: {
      heading: string;
      body: string;
    };
    /** Path or URL to the hero/background image. */
    backgroundImage: string;
    /**
     * CSS `background-size` value for the hero image, e.g. "contain",
     * "cover", "auto", or a fixed size like "50% auto". Defaults to
     * "contain" so the image scales down to fit without stretching or
     * cropping — any leftover space is filled by the page's own
     * `--color-bg`, since `.hero-background` doesn't paint its own
     * background color over the full area.
     */
    backgroundSize: string;
    /**
     * Path or URL to the event's name/title graphic. Rendered in place of
     * the event name wherever it would otherwise appear as plain text, so a
     * future year's re-theme can swap in a new logo the same way
     * `backgroundImage` already works: change this path and drop in the new
     * file, no component code changes needed.
     */
    logoImage: string;
    /**
     * Path or URL to this year's theme-name graphic (e.g. a custom SVG
     * created fresh each year), rendered in place of `event.themeName`
     * wherever it would otherwise appear as plain text. Swappable the same
     * way `backgroundImage`/`logoImage` are.
     */
    themeImage: string;
    /**
     * Path or URL to the default photo shown for a guest or group with no
     * photo uploaded yet, in place of a generic/framework icon — the admin
     * Guests page (list and grid views, and the add/edit photo control),
     * the voting page's nominee carousel, and the "Your Group" panel all
     * render this instead of their own hardcoded fallback. Swappable per
     * year the same way `backgroundImage`/`logoImage` are.
     */
    placeholderImage: string;
  };
  voting: {
    categories: VotingCategory[];
    /**
     * Path or URL to this year's costume-contest prize/plaque photo, shown
     * on the voting page after the last category. Swappable per year the
     * same way `theme.backgroundImage`/`theme.logoImage`/`theme.themeImage`
     * are. Optional — when unset, the voting page skips the prize section
     * entirely, so existing configs without it don't break.
     */
    prizeImage?: string;
  };
}
