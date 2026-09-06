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

Same pattern again for the no-photo placeholder (`theme.placeholderImage`,
default `no-photo.svg`): shown in place of a guest's or group's photo
wherever it hasn't been uploaded yet — the admin Guests page (list view,
grid view, and the add/edit photo control), the voting page's nominee
carousel, and the "Your Group" panel all read this from config rather than
a hardcoded icon.

Same pattern again for the theme-name graphic (`theme.themeImage`, default
`theme.svg`): a custom SVG created fresh each year to represent the theme
name (`event.themeName`) on the home page, rendered via the shared
`ThemeImage` component (`src/components/ThemeImage.tsx`) in place of plain
text.
