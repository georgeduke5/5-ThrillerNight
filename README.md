# Thriller Night Website

Open-source, reusable website for an annual Halloween party. Two independent,
toggleable modules — **Costume Voting** (fully built, Phase 1) and
**Invitation/RSVP** (structural stub only, Phase 2) — sit behind a single
config-driven theme and a swappable data access layer. See
[`Docs/thriller-night-website-requirements.md`](Docs/thriller-night-website-requirements.md)
for the full requirements this build implements.

No personal information, guest data, or event-specific copy is committed to
this repo. Everything that varies year to year — event details, theme
colors/fonts/images, feature toggles, costume categories, and all guest/vote
data — is supplied at runtime via `config/site.config.json` (gitignored),
environment variables, and the Google Sheet, never hardcoded.

## Stack

- **Next.js 14 (App Router) + TypeScript**, deployed on **Vercel's free tier**
  — static pages plus serverless functions (Route Handlers) in one deploy,
  matching the "static site + serverless function calling the Sheets API"
  architecture in the requirements doc.
- **Tailwind CSS**, themed entirely through CSS custom properties generated
  from config (`src/lib/config/theme.ts`) — no component ever hardcodes a
  color, font, or image path.
- **Google Sheets** as the backend, accessed only through a `DataStore`
  interface (`src/lib/data-access/DataStore.ts`). The Google Sheets
  implementation lives in `src/lib/data-access/google-sheets/`; swapping
  backends later means writing a new implementation of that interface and
  adding one case to the factory in `src/lib/data-access/index.ts` — nothing
  else in the app changes.
- **Google Drive** for costume photo storage, behind its own small
  `PhotoStorage` interface (`src/lib/photo-storage/`), decoupled from the
  data access layer since it's a binary-storage concern, not a data-storage
  one. Uploads authenticate via OAuth as a personal Google account rather
  than the Sheets service account — see "Google Drive" under One-time setup
  for why.
- **Twilio Verify** for phone-based SMS one-time-code verification, gating
  vote *submission* only (browsing nominees stays open). A verified session
  is a small signed cookie tied to a guest's id (`src/lib/auth/voterSession.ts`,
  mirroring the existing admin session pattern) — no phone number is ever
  stored.

## Project structure

```
config/site.config.example.json   Committed template for runtime config (copy → site.config.json)
src/lib/config/                   Config loader + theme CSS variable generation
src/lib/data-access/              DataStore interface, types, Google Sheets implementation, factory
src/lib/csv-import/               Generic CSV parsing + pluggable source-format mappers (Evite today)
src/lib/photo-storage/            PhotoStorage interface + Google Drive implementation
src/lib/auth/                     Minimal signed-cookie admin + voter (phone-verified) sessions
src/lib/rsvp/                     Shared person/household types for the Phase 2 RSVP stub
src/app/                          Pages (App Router) and API route handlers
src/app/vote/                     Costume Voting module (public)
src/app/invite/                   Invitation/RSVP module (Phase 1 stub, 404s when disabled)
src/app/admin/                    Admin panel (guests, groups, CSV import, photos, voting controls)
src/components/                   React components, grouped by module
```

## One-time setup

### 1. Google Cloud service account

1. Create a Google Cloud project (or reuse one) and enable the **Google
   Sheets API** and **Google Drive API**.
2. Create a service account, then create a JSON key for it. You'll need its
   `client_email` and `private_key`.

### 2. Google Sheet (guest/vote/group/settings store)

Create a spreadsheet with four tabs, each with a header row exactly matching
below (column order matters), and share the spreadsheet with the service
account's email as **Editor**.

**`Guests`**

| id | firstName | lastName | bracket | photoRef | photoUrl | source | createdAt | groupId |
|----|-----------|----------|---------|----------|----------|--------|-----------|---------|

**`Votes`**

| voterGuestId | category | nomineeId | timestamp |
|--------------|----------|-----------|-----------|

**`Groups`**

| id | name | photoRef | photoUrl | memberIds | createdAt |
|----|------|----------|----------|-----------|-----------|

**`Settings`**

| key | value |
|-----|-------|

Leave all four otherwise empty — the app appends rows itself. `bracket`
values are `adult-male`, `adult-female`, `boy`, or `girl` — every guest
self-registers into exactly one of these four; there is no "couple/group"
bracket a guest can pick (see the Costume Voting section below). `groupId`
is blank until a guest creates or joins a Couple/Group entry — a guest
belongs to at most one group. `Votes.nomineeId` is a Guest id for
guest-based categories or a Group id for the Couple/Group category.
`Groups.memberIds` is a comma-joined list of guest ids. `Settings` rows
(`votingOpen`, `resultsPublished`) are created automatically the first time
an admin toggles them and default to closed/unpublished until then.

### 3. Google Drive (costume photos, optional)

Photo upload stores files in a **personal Google Drive**, uploaded via
OAuth as that account rather than through the service account above. This
is deliberate: a bare service account cannot own Drive files (or write into
a personal folder merely *shared* with it) outside a Google Workspace
Shared Drive — Google's API rejects both with a `storageQuotaExceeded`
error — and a personal Gmail account has no Shared Drives to fall back on.
Authenticating as the real personal account sidesteps this entirely: that
account owns every uploaded photo outright, with no extra "share with me"
step needed, and photos just show up in that account's own Drive.

Skip this section if you don't need photo upload yet.

1. In the same Google Cloud project as your service account, configure the
   **OAuth consent screen** (APIs & Services → OAuth consent screen) if you
   haven't already — User type **External**, publishing status **Testing**
   is fine, and add the Google account that will own the photos as a
   **test user**. This avoids Google blocking the one-time authorization
   below as an "unverified app."
2. Create an **OAuth 2.0 Client ID** (APIs & Services → Credentials →
   Create Credentials → OAuth client ID → Application type: **Desktop
   app**). Note the client ID and client secret.
3. Put those two values in `.env.local` as `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_CLIENT_SECRET` (see `.env.example`).
4. Create (or pick an existing) folder in that Google account's Drive for
   photos to land in. Open it in Drive and copy its id out of the URL —
   `drive.google.com/drive/folders/<this-part-is-the-id>` — into
   `.env.local` as `GOOGLE_DRIVE_PHOTOS_FOLDER_ID`.
5. Run `npm run drive:auth`. It prints a URL — open it, sign in with the
   Google account that should own the uploaded photos, and approve access.
   The script then prints `GOOGLE_OAUTH_REFRESH_TOKEN`; add that to
   `.env.local` too.

   This requests Drive's narrow `drive.file` scope for uploads
   (least-privilege — the app can only ever *create or modify* files it
   makes itself, never anything else in your Drive; confirmed directly
   that this is enough to create new files inside the pre-existing folder
   from step 4, even though that scope can't independently read/list the
   folder itself as a resource), plus read-only `drive.readonly` so admin
   tooling can *look up* pre-existing files by name — e.g. bulk-linking
   photos you copy into the folder yourself, outside the app — without
   being able to modify or delete anything it didn't create.

If you ever need to revoke this, remove the app from
[myaccount.google.com/permissions](https://myaccount.google.com/permissions)
and re-run `npm run drive:auth` to issue a new refresh token.

### 4. Twilio Verify (phone verification for voting, optional)

Vote *submission* (not browsing) is gated behind a one-time SMS code, so a
guest verifies once per browser session rather than every time they change
their vote. Skip this section if you don't need voting yet — browsing the
site and nominee photos never requires it.

1. Create a [Twilio](https://www.twilio.com/try-twilio) account.
2. In the Twilio Console, create a **Verify Service** (Verify → Services →
   Create new). Note its Service SID.
3. From the Console's dashboard, note your **Account SID** and **Auth
   Token**.
4. Put all three in `.env.local` as `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` (see `.env.example`).

No phone number is ever stored by the app — Twilio Verify is stateless from
our side; a successful check just issues a signed session cookie bound to
the guest's id (`src/lib/auth/voterSession.ts`), reusing the existing
`SESSION_SECRET`. This is deliberately a lightweight per-session gate, not
a per-guest phone lock — the same phone can verify as different guests over
time (e.g. a parent voting on behalf of their kid).

### 5. Environment variables

Copy `.env.example` to `.env.local` and fill in the service account email,
private key, Sheet ID, the Drive OAuth client id/secret/refresh token and
photos folder id, the three Twilio values (see above — Drive and Twilio are
only needed for photo upload and voting respectively), an `ADMIN_PASSWORD`,
and a random `SESSION_SECRET`. On Vercel/Netlify, set the same variables in
the dashboard instead of committing a file.

### 6. Site config (event details, theme, toggles, categories)

Copy `config/site.config.example.json` to `config/site.config.json` (already
gitignored) and fill in this year's event name, theme name, date/times,
colors/fonts, background image path, feature toggles, and costume categories.
Every field can alternatively be set via `SITE_*` environment variables (see
`src/lib/config/index.ts`) for hosts where committing even a gitignored local
file is inconvenient — env vars win if both are set.

Drop the background image itself in `public/images/` (see the README there).

## Running locally

```bash
npm install
npm run dev
```

Visit `/` for the public site, `/vote` for costume voting, and
`/admin/login` for the admin panel.

## Re-theming for a new year

1. Edit `config/site.config.json` (or the matching env vars): event name,
   theme name, date/times, colors, fonts, costume categories.
2. Swap the file in `public/images/` and update `theme.backgroundImage` if
   the filename changed. `theme.backgroundSize` controls how it's scaled
   (any valid CSS `background-size` value — defaults to `"contain"`, so the
   image fits without stretching or cropping; use `"cover"` to fill the
   viewport edge-to-edge instead, at the cost of cropping the image).
3. Swap `theme.logoImage` the same way for the event's name/title graphic —
   it's rendered via the shared `EventLogo` component wherever the event
   name would otherwise appear as text (home page, the invite landing page,
   and the voting page header).

No component code should ever need to change for a re-theme — if it does,
that's a bug in the theming system, not an expected step.

## Costume Voting module (Phase 1)

- **Guest/nominee data entry**: `/admin/guests` for manual add/edit, or
  `/admin/import` to bulk-import an Evite CSV export. The importer maps
  Evite's columns to the app's guest shape, then requires the admin to
  assign a bracket per guest — Adult Male, Adult Female, Boy, or Girl
  (Evite doesn't export it) — before anything is written. Adding a future
  source format means writing a new mapper in `src/lib/csv-import/mappers/`
  — the parse/review/confirm flow doesn't change.
- **Voting categories**: four brackets (Adult Male, Adult Female, Boy, Girl)
  each get their own costume category, filled automatically from guests
  registered into that bracket. A fifth category, Couple/Group, nominates
  **Group** records instead of individual guests (`VotingCategory.nomineeType:
  "group"`) — a guest can't register themselves directly into it, but can
  create or join a group after registering (see below).
- **Groups**: a persistent "Your Group" panel on `/vote`, reachable by any
  identified voter at any time (not just right after registering). A guest
  who isn't in a group can create one (name + photo, via the same upload
  flow as guest photos) or join an existing one by name; once in a group,
  any member can add other guests to it. A guest belongs to at most one
  group. `/admin/groups` gives admins a lean rename-only view; group photos
  are (re)assigned from `/admin/photos`, which has a Guest/Couple-Group
  toggle.
- **Voting**: `/vote` — identify yourself by name (open, no verification),
  then browse each category's nominees as a swipeable photo carousel (name
  above, photo centered — swipe, click the arrows, or use the keyboard's
  left/right arrows to move between nominees) and tap "Vote for this
  Costume" to vote for whoever's centered. **Submitting** a vote (not
  browsing) requires a one-time phone verification the first time each
  session (see Twilio Verify above) — after that, changing your vote in any
  category doesn't re-prompt. Voting is identity-based: a repeat submission
  from the same person overwrites their prior pick per category
  (`DataStore.recordVote` is an upsert keyed on voter+category), not
  device-locked — this is also how "un-voting" works, since picking the
  same or a different nominee again just updates the existing record.
  `/vote/walkin` lets an unlisted guest add themselves on the spot by
  choosing one of the four brackets (required).
- **Results**: `/vote/results` is a public reveal page that only shows real
  data once an admin publishes results from `/admin/voting`; the admin panel
  itself can always see live tallies while voting is open or closed. Results
  for the Couple/Group category show the group's name, not any member's.
- **Photos**: `/admin/photos` (admin-tagged, guest or group) and the
  `POST /api/photos` endpoint (also used by the guest-facing group-photo
  upload in the "Your Group" panel) both go through the same
  `PhotoStorage`/`DataStore` write path. Every photo is standardized to a
  4:5 portrait crop: whoever uploads gets a pan/zoom crop step
  (`src/components/PhotoCropModal.tsx`, canvas-based, no cropper
  dependency) before it saves, and the voting carousel additionally applies
  a CSS center-crop fallback (`aspect-[4/5]` + `object-cover`) so even a
  photo that predates this feature never shows blank space.

## Invitation/RSVP module (Phase 2 stub)

`src/app/invite/` contains a stub landing page and stub RSVP form
(`src/lib/rsvp/types.ts` documents the intended data shape, matching the
guest structure the Voting module already uses). Both pages `notFound()`
whenever `invitationModuleEnabled` is `false`, so nothing is linked or
partially rendered on the live site until Phase 2 build-out flips the
toggle and fills in the real experience described in Section 6.2 of the
requirements doc.

## Deployment

Push to a public GitHub repo and import it into Vercel (free tier). Set the
environment variables from `.env.example` in the Vercel project settings —
do not commit `.env.local` or `config/site.config.json`.
