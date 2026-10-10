import ReactDOM from "react-dom";
import { getSiteConfig } from "@/lib/config";

/**
 * Hints the browser to start fetching the hero background image as soon as
 * the initial HTML arrives, instead of waiting for globals.css's
 * .hero-background rule to be fetched and parsed first — a CSS
 * background-image URL isn't discoverable until then, unlike an <img> src.
 * Works from a Server Component: React/Next stream this straight into the
 * document <head> as `<link rel="preload" as="image">` (see
 * ReactDOM.preload in React's docs). Dropped into each guest-facing page
 * that renders .hero-background, next to that page's own HomeLink/
 * ResultsHeader — never rendered on any admin page, which doesn't use this
 * background at all.
 */
export function BackgroundPreload() {
  const config = getSiteConfig();
  ReactDOM.preload(config.theme.backgroundImage, { as: "image" });
  return null;
}
