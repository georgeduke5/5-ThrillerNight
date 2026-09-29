"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

const VIDEO_ID = "dQw4w9WgXcQ";
/**
 * The YouTube IFrame API replaces the element with this id with the actual
 * generated <iframe> (reusing the same id, but NOT the className or any
 * other attribute) — see the matching #privacy-policy-video-player rule in
 * globals.css, which is what actually sizes/positions it.
 */
const PLAYER_ELEMENT_ID = "privacy-policy-video-player";

/**
 * Minimal ambient typing for the small slice of the YouTube IFrame Player
 * API this component actually calls — not worth pulling in a full
 * @types/youtube dependency for four methods.
 */
interface YTPlayer {
  playVideo(): void;
  unMute(): void;
}

interface YTPlayerEvent {
  target: YTPlayer;
  data?: number;
}

interface YTPlayerOptions {
  videoId: string;
  host?: string;
  playerVars?: Record<string, number | string>;
  events?: {
    onReady?: (event: YTPlayerEvent) => void;
    onStateChange?: (event: YTPlayerEvent) => void;
  };
}

declare global {
  interface Window {
    YT?: {
      Player: new (elementId: string, options: YTPlayerOptions) => YTPlayer;
      PlayerState: { PLAYING: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/**
 * Renders the Privacy Policy page's Rick Astley embed via the YouTube
 * IFrame Player API (not a plain static <iframe>) so playback can be driven
 * from JS. That's what makes autoplay-with-sound actually work everywhere,
 * iOS Safari included:
 *
 * - iOS Safari refuses to autoplay ANY video, even muted, unless
 *   `playsinline` is set — without it, starting playback would require
 *   going fullscreen first, which iOS blocks without a direct user gesture
 *   on the video itself, so it just silently does nothing. A footer link
 *   click on a *different* page earlier doesn't count as that gesture.
 * - Muted autoplay (with playsinline) is allowed unconditionally, with no
 *   gesture required, on every modern browser including iOS Safari.
 * - Starting *unmuted* via a `mute=0` URL param is NOT reliably allowed
 *   cross-browser — desktop Chromium can delegate a prior same-origin
 *   navigation gesture to a cross-origin iframe's autoplay permission, but
 *   WebKit/iOS Safari has no equivalent mechanism at all, gesture or not.
 * - WebKit's actual rule is specifically about *starting* playback: once a
 *   video is already playing — even muted, even autoplay-started with zero
 *   gesture — toggling its mute state requires no further gesture. That's
 *   the standard "autoplay muted, then unmute via the API" pattern: start
 *   muted (always allowed), then call `unMute()` immediately once playback
 *   begins, in the same tick as page load. This works identically on
 *   desktop, so it doesn't regress the previously-confirmed Chrome
 *   behavior — it just stops depending on Chromium's gesture-delegation
 *   quirk, which iOS never had to begin with.
 */
export function PrivacyPolicyVideo() {
  const unmutedRef = useRef(false);
  const createdRef = useRef(false);

  useEffect(() => {
    function unmuteOnce(player: YTPlayer) {
      if (unmutedRef.current) return;
      unmutedRef.current = true;
      player.unMute();
    }

    function createPlayer() {
      if (createdRef.current || !window.YT) return;
      createdRef.current = true;
      new window.YT.Player(PLAYER_ELEMENT_ID, {
        videoId: VIDEO_ID,
        // Privacy-enhanced embed domain — matches next.config.mjs's
        // frame-src allowance for the iframe this constructs.
        host: "https://www.youtube-nocookie.com",
        playerVars: {
          playsinline: 1,
          autoplay: 1,
          mute: 1,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            event.target.playVideo();
            unmuteOnce(event.target);
          },
          onStateChange: (event) => {
            if (event.data === window.YT?.PlayerState.PLAYING) {
              unmuteOnce(event.target);
            }
          },
        },
      });
    }

    if (window.YT?.Player) {
      createPlayer();
      return;
    }

    // The IFrame API supports exactly one global ready callback — chain
    // onto whatever's already registered instead of clobbering it.
    const previousCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      createPlayer();
    };
  }, []);

  return (
    <>
      <Script src="https://www.youtube.com/iframe_api" strategy="afterInteractive" />
      <div id={PLAYER_ELEMENT_ID} />
    </>
  );
}
