# Theme images

Drop this year's background image here (e.g. `background.jpg`) and point
`theme.backgroundImage` in `config/site.config.json` at `/images/background.jpg`.
Swapping the file (and the config path, if the filename changes) is the
entire re-theming step for the hero background — no component code needs to
change. See Section 4 of the requirements doc.

Same pattern for the event's name/title graphic: drop it here (e.g.
`logo.png`) and point `theme.logoImage` at it. It's rendered via the shared
`EventLogo` component (`src/components/EventLogo.tsx`) everywhere the event
name would otherwise appear as text.
