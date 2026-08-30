# Thriller Night Website — Requirements Document (v2)

## 1. Overview

This is an **open-source** website project supporting "Thriller Night," an annual Halloween party hosted by George and Sarah, expecting 75+ guests, with a new movie theme every year. The project must be reusable year over year and shareable publicly as open source, which means:

- **No personal information, addresses, guest data, or event-specific copy may be hardcoded.** All configuration (event name, date, times, theme, colors, background images, feature toggles, etc.) is supplied at runtime via a config file or environment variables, not committed to the codebase.
- The project is built in **two independent, toggleable modules**: an **Invitation/RSVP module** and a **Costume Voting module**. Each can be enabled or disabled independently via configuration.

## 2. Phased Rollout

### Phase 1 (This Year)
- **Invitation/RSVP module: DISABLED.** Invitations are handled externally this year via Evite.
- Only a **skeleton/stub** of the Invitation module needs to exist in code this year — enough structure to prove the toggle works and to serve as a scaffold for Phase 2, but not a fully built experience.
- **Costume Voting module: FULLY BUILT AND FUNCTIONAL.** This is the priority for this year's build.
- Guest/voter data needed for voting (names, adult/minor status) will need a lightweight way to be entered this year since the full RSVP pipeline isn't live — see Section 5.1.

### Phase 2 (Next Year and Beyond)
- **Invitation/RSVP module: ENABLED.** The custom-built invitation site (per the original RSVP/landing page spec) replaces Evite.
- **Costume Voting module: ENABLED**, now fed directly by RSVP data instead of a manual guest list entry.
- Both modules should be able to run together seamlessly once Phase 2 begins, with the RSVP module automatically populating the voter/nominee pool used by the Voting module.

## 3. Architecture

- **Frontend:** Static site (HTML/CSS/JS or a lightweight framework), open source, hosted on a public repo.
- **Hosting:** Free static hosting (e.g. Vercel, Netlify, or GitHub Pages) — a real public URL, not dependent on a personal machine.
- **Backend/data store:** Google Sheets, written to via a serverless function or Google Apps Script calling the Sheets API. No database server to manage. The specific Sheet ID/credentials are runtime configuration, never committed to the repo.
- **Data Access Layer (required):** All reads and writes to guest, vote, and photo data must go through a single, discrete data access layer (e.g. a `DataStore` interface/module with methods like `getGuests()`, `addGuest()`, `recordVote()`, `getVotes()`, `savePhotoReference()`, etc.). No other part of the application — pages, forms, admin panel, voting logic — may talk to Google Sheets (or any future store) directly.
  - The current concrete implementation of this layer connects to a Google Sheets–based spreadsheet backend.
  - Because the rest of the app only ever calls the data access layer's interface, swapping the backend to a different data store in the future (a different spreadsheet service, a real database, etc.) should only require writing a new implementation of that interface — no changes anywhere else in the codebase.
  - This should be structured so the concrete backend implementation is chosen via runtime configuration, not hardcoded, to make future swaps painless.
- **Configuration system:** A single, clearly documented config file (e.g. `config.json` or `.env`) that controls:
  - `invitationModuleEnabled: true/false`
  - `votingModuleEnabled: true/false`
  - Event name, date, arrival/end times
  - Theme name and any theme-specific copy
  - Background image(s), color palette, font choices — configuration should make re-theming **easy and intuitive**, ideally just swapping image files and a few color/font values, no code changes required
  - Google Sheet ID / API credentials (kept out of source control, e.g. via `.env` + `.gitignore`)
- **No Airtable.**

## 4. Design & Aesthetic Requirements

- Dark, black-based color palette by default, with layered spooky visual elements (fog, texture, depth) — but colors/fonts/images should all be overridable via config for future themes.
- A large background image sets the tone; supplied via config, not hardcoded, so it's a drop-in swap each year.
- Every actionable call-to-action (RSVP, Vote, etc.) must be **impossible to miss**: big, bold, Arial-style sans-serif font, high contrast against the background.
- Theming should require editing config values and swapping image assets only — no touching component code to reskin the site for a new year.

## 5. Costume Voting Module (Phase 1 priority — build this year)

### 5.1 Guest/Nominee Data Entry (Phase 1 stand-in for RSVP data)
- Since the RSVP module is disabled this year, there needs to be a simple way to get the guest/voter/nominee list into the system — e.g. an admin-only form or a direct-edit Google Sheet tab with columns: first name, last name, adult/minor flag.
- This should be built so that in Phase 2, the same underlying data structure is simply populated automatically by RSVP submissions instead of manual entry — the Voting module should not need to change when the Invitation module comes online.
- **CSV Import (required):** the admin panel must support importing a CSV file exported from Evite to bulk-populate the guest/nominee list, rather than requiring guests to be entered one at a time.
  - The importer must map Evite's exported CSV column format (guest name, RSVP status, etc.) into the app's internal guest data structure (first name, last name, adult/minor flag).
  - Evite's export does not include an adult/minor designation, so the import flow must let the admin assign or confirm adult/minor status for each imported guest (e.g. during or immediately after import), rather than guessing.
  - Imports must go through the data access layer (Section 3) like any other guest data write — the import feature should not write to the backend directly.
  - This importer should be written generically enough that a different CSV format (e.g. from a future invitation tool) could be supported later by adding a new mapping, without reworking the rest of the import flow.

### 5.2 Voting Page
- Access via a printed QR code at the party (multiple copies around the venue to avoid bottlenecks).
- **Voting flow:**
  1. Voter identifies themselves by selecting their own name (first + last) from the guest list.
  2. Voter casts one selection in each of four categories: Best Boy Costume, Best Girl Costume, Best Adult Male Costume, Best Adult Female Costume.
  3. Each category's list is automatically filtered to the correct bracket (minors only under Boy/Girl, adults only under Adult Male/Adult Female).
  4. If a voter doesn't know who's who, they can browse a **photo gallery view** per category — scrollable cards showing each nominee's photo, name, and a "Vote for this person" button.
  5. Voting is **identity-based, not device-based** — any device works. A repeat vote from the same identified voter **overwrites** their prior selection rather than counting twice.
- **Walk-in guests:** a separate printed QR code lets an unlisted guest add themselves to the guest/nominee list on the spot (a minimal name + adult/minor entry, standing in for a full RSVP this year). Once added, they're immediately eligible for a photo and for voting.

### 5.3 Costume Photo Upload
- Photos can be uploaded and tagged to a specific guest by either the guest themselves or by George/Sarah via the admin function.
- Each photo is associated with a guest name so it appears in the category voting galleries.

### 5.4 Admin Panel
- Private, not publicly linked.
- **Voting status toggle:** "Voting Open" / "Voting Closed."
- **Results visibility:** admins can privately view live tallied results at any time while voting is open or closed-but-unpublished. Results are hidden from guests until explicitly published.
- **Publish results:** a distinct action from closing voting — admins close voting, review results privately, then choose to make them public.
- Guest/nominee list management (add/edit entries — doubles as the Phase 1 stand-in for RSVP-based population).
- Photo upload/tagging capability.

### 5.5 Data (Google Sheet structure, conceptually)
- **Guest/Nominee list:** first name, last name, adult/minor flag, photo reference (if uploaded). (In Phase 2, additional RSVP fields — email, household, food item — get added but don't change the voting logic.)
- **Votes:** voter identity (name), category, selected nominee, timestamp — a new vote from the same voter in the same category overwrites the prior entry.

## 6. Invitation/RSVP Module (Phase 1 skeleton only; full build in Phase 2)

Build only enough this year to establish the toggle and folder/component structure; do not invest significant time in the full experience until Phase 2.

### 6.1 Phase 1 Scope
- A stub landing page component and a stub RSVP form component exist in the codebase.
- `invitationModuleEnabled: false` in config hides/disables this module entirely from the live site this year (no broken links, no partial UI shown to guests).
- Data structures used by the stub (guest name, email, adult/minor, household) should match Section 5.1's guest data structure so the transition to Phase 2 doesn't require reworking the Voting module.

### 6.2 Phase 2 Full Scope (for future build-out)
- **General Information / Landing Page:** describes the party, what to expect, date/arrival/end times (no address — sent separately via email), prominent "everyone wears a costume" messaging, big bold RSVP call-to-action.
- **RSVP Form:** one submission per household; primary registrant (first + last name, required email) plus additional guests (first + last name required, email optional each); every person tagged adult/minor; optional food-item field; returning-visitor detection (already-RSVP'd guests see a confirmation state instead of a blank form).
- **Post-RSVP Content Page:** trivia/fun facts about the year's movie theme, past-party highlights, other lighthearted content, shown to guests who've already RSVP'd.
- Feeds guest/nominee data directly into the Voting module's data structure (Section 5.1/5.5).

## 7. Recurring Context (for future re-theming and open-source reuse)

- The party must stay family-friendly enough for younger siblings and free of anything anti-Christian or offensive to a church-going crowd, even when the movie theme skews adult. Trivia/content should lean on iconic/stylish elements of the theme rather than dark or graphic content. (This is a content guideline for whoever configures a given year's copy, not something to hardcode.)
- Past themes (do not repeat): Dracula/witch (no formal theme, year 1), Beetlejuice, The Shining, Silence of the Lambs (current year).
- Future theme ideas already floated: Texas Chainsaw Massacre, Gremlins.
- This year's costume contest categories: Best Boy Costume, Best Girl Costume, Best Adult Male Costume, Best Adult Female Costume — each winner receives a handmade wooden plaque. (Category list should itself be configurable, not hardcoded, in case future years want different categories.)

## 8. Explicit Non-Requirements / Constraints

- No cost for hosting or backend — everything free.
- No Airtable.
- No hardcoded personal information, guest data, addresses, or event-specific credentials anywhere in the source code — all such data lives in runtime config or the Google Sheet, and the repo's `.gitignore` must exclude any local config/secrets files.
- No public listing of the home address anywhere on the site.
- No device-based vote locking (identity-based only, per Section 5.2).
- Invitation module and Voting module must be independently toggleable via config at all times, not just at initial setup.
