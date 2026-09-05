import type { Config } from "tailwindcss";

// Colors and fonts are intentionally NOT hardcoded here. They read from CSS
// custom properties (--color-*, --font-*) that the ThemeProvider sets at
// runtime from config/site.config.json. This lets a new year's theme be
// applied by editing config + swapping images only — no touching this file
// or any component. See src/lib/config/theme.ts.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        primary: "var(--color-primary)",
        accent: "var(--color-accent)",
        text: "var(--color-text)",
        muted: "var(--color-muted)",
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        body: ["var(--font-body)"],
      },
      backgroundImage: {
        hero: "var(--image-background)",
      },
    },
  },
  plugins: [],
};

export default config;
