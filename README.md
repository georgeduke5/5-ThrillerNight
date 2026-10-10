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
  is a small signed cookie tied to a guest's id (`src/lib/auth/voterSession.ts`)
  — no phone number is ever stored. Admin-portal access reuses this same
  session rather than its own login: see "Admin access" below.

## Project structure

```
config/site.config.example.json   Committed template for runtime config (copy → site.config.json)
src/lib/config/                   Config loader + theme CSS variable generation
src/lib/data-access/              DataStore interface, types, Google Sheets implementation, factory
src/lib/csv-import/               Generic CSV parsing + pluggable source-format mappers (Evite today)
src/lib/photo-storage/            PhotoStorage interface + Google Drive implementation
src/lib/auth/                     Minimal signed-cookie voter (phone/passkey-verified) session + admin authorization
src/lib/rsvp/                     Shared person/household types for the Phase 2 RSVP stub
src/app/                          Pages (App Router) and API route handlers
src/app/vote/                     Costume Voting module (public)
src/app/candy-count/              Candy Count contest module (public)
src/app/invite/                   Invitation/RSVP module (Phase 1 stub, 404s when disabled)
src/app/admin/                    Admin panel (guests, groups, CSV import, photos, voting/candy controls)
src/components/                   React components, grouped by module
```

## One-time setup

### 1. Google Cloud service account

1. Create a Google Cloud project (or reuse one) and enable the **Google
   Sheets API** and **Google Drive API**.
2. Create a service account, then create a JSON key for it. You'll need its
   `client_email` and `private_key`.

### 2. Google Sheet (guest/vote/group/settings store)

Create a spreadsheet with six tabs, each with a header row exactly matching
below (column order matters), and share the spreadsheet with the service
account's email as **Editor**.

**`Guests`**

| id | firstName | lastName | bracket | photoRef | photoUrl | source | createdAt | groupId | phone | checkedInAt | pendingApprovalAt | isAdmin |
|----|-----------|----------|---------|----------|----------|--------|-----------|---------|-------|-------------|-------------------|---------|

**`Votes`**

| voterGuestId | category | nomineeId | timestamp |
|--------------|----------|-----------|-----------|

**`Groups`**

| id | name | photoRef | photoUrl | memberIds | createdAt |
|----|------|----------|----------|-----------|-----------|

**`Settings`**

| key | value |
|-----|-------|

**`Passkeys`**

| guestId | credentialId | publicKey | counter | transports | createdAt |
|---------|--------------|-----------|---------|------------|-----------|

**`CandyGuesses`**

| guestId | guestName | guess | timestamp |
|---------|-----------|-------|-----------|

Leave all six otherwise empty — the app appends rows itself. `bracket`
values are `adult-male`, `adult-female`, `boy`, or `girl` — every guest
self-registers into exactly one of these four; there is no "couple/group"
bracket a guest can pick (see the Costume Voting section below). `groupId`
is blank until a guest creates or joins a Couple/Group entry — a guest
belongs to at most one group. `phone` is an optional admin-entered contact
number, blank unless set from `/admin/guests` — unrelated to Twilio Verify
(see below), which never stores the phone number used to verify.
`checkedInAt` is blank until a guest first completes phone verification
(via the "Check In" button or the per-vote prompt — see Check-in below),
then holds that first verification's ISO timestamp permanently.
`pendingApprovalAt` is blank unless a guest completed their very first
passkey registration with no phone on file to verify against — that guest
gets full normal site access but is held out of "checked in" until an admin
approves or rejects them on /admin/check-in (see Passkey login below).
`isAdmin` is blank for every guest except whoever should have admin-portal
access — type `TRUE` (case-insensitive; anything else, including blank,
means no) directly into that guest's row. There is no separate admin
password or login screen: whoever is checked in (via the normal passkey/
phone flow) as a guest flagged this way sees an "Admin" link on the home
page and gets full admin access with no further login step — see Admin
access below. Only ever edit this column directly in the sheet; it's
deliberately not exposed anywhere in the admin UI itself.
`Votes.nomineeId` is a Guest id for guest-based categories or a Group id
for the Couple/Group category.
`Groups.memberIds` is a comma-joined list of guest ids. `Settings` rows
(`votingOpen`, `resultsPublished`, `phoneVerificationEnabled`,
`passkeyAuthEnabled`, `selfServiceWalkinEnabled`, `candyGuessingOpen`,
`candyResultsPublished`, `candyTrueCount`) are created automatically the
first time an admin toggles/sets them; `votingOpen`, `resultsPublished`,
`candyGuessingOpen`, and `candyResultsPublished` default to
closed/unpublished, while `phoneVerificationEnabled`, `passkeyAuthEnabled`,
and `selfServiceWalkinEnabled` all default **on** for any deployment
that's never had that row written (see Passkey login below — an admin can
still switch it off from the dashboard). `candyTrueCount` is blank until an
admin enters the actual candy count on `/admin/candy-count`.

`Passkeys` holds at most one row per guest — `guestId` links back to
`Guests.id`, `credentialId` and `publicKey` are base64url, `counter` is the
authenticator's signature counter, and `transports` is a comma-joined hint
list. Rows are written by the passkey ceremonies and cleared when a guest is
deleted; nothing in this tab is ever sent to a browser.

`CandyGuesses` holds at most one row per guest — `guestId` links back to
`Guests.id`, `guestName` is denormalized for readability at a glance (the
app still resolves display names live against the `Guests` tab when
computing results, so a later name change or guest deletion doesn't leave
stale names in results). A repeat submission overwrites the existing row
rather than adding a second one, and rows are cleared when a guest is
deleted, same as `Votes`/`Passkeys`.

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

### 4. Twilio Verify (phone verification for voting and check-in, optional)

Vote *submission* (not browsing) is gated behind a one-time SMS code, so a
guest verifies once per browser session rather than every time they change
their vote. The same verification flow also backs the home page's "Check
In" button — whichever one a guest completes first satisfies both. Skip
this section if you don't need voting yet — browsing the site and nominee
photos never requires it.

1. Create a [Twilio](https://www.twilio.com/try-twilio) account.
2. In the Twilio Console, create a **Verify Service** (Verify → Services →
   Create new). Note its Service SID.
3. From the Console's dashboard, note your **Account SID** and **Auth
   Token**.
4. Put all three in `.env.local` as `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` (see `.env.example`).

No phone number is ever stored by the verification flow itself — Twilio
Verify is stateless from our side; a successful check just issues a signed
session cookie bound to the guest's id (`src/lib/auth/voterSession.ts`),
reusing the existing `SESSION_SECRET`. This is deliberately a lightweight
per-session gate, not a per-guest phone lock — the same phone can verify as
different guests over time (e.g. a parent voting on behalf of their kid).
Separately, `Guest.phone` is an optional admin-entered contact number
(set from `/admin/guests`) for reaching guests directly — it's independent
of, and never populated by, this verification flow. It's retained
long-term (for future RSVP messaging) and encrypted at rest — see
`PHONE_ENCRYPTION_KEY` in `.env.example`, generated the same way as
`SESSION_SECRET` but kept as a separate secret.

### 5. Passkey login (WebAuthn, optional — replaces the SMS step when on)

Passkey login is the alternative to the Twilio step above: after a guest
picks their name, they confirm with Face ID / fingerprint / screen lock
instead of receiving a code. The two are **swappable strategies, not a
migration** — neither one's code is removed when the other is active, and
the Twilio setup above stays in place regardless (it also remains available
for any other outbound SMS).

Which one runs is the **Passkey Login** toggle on the admin dashboard
(`/admin` and `/admin/voting`), stored as the `passkeyAuthEnabled` row in
the `Settings` tab. It defaults **on** for any deployment that's never had
that row written — same as the other toggles — so double-check the
relying-party values below actually match your domain before the party if
you haven't already; flip the toggle off from the dashboard if you need to
fall back to the SMS flow for any reason.

Relying-party config lives under `auth.passkey` in `site.config.json`, or
as `SITE_PASSKEY_RP_NAME` / `SITE_PASSKEY_RP_ID` / `SITE_PASSKEY_ORIGINS`
(comma-separated) environment variables:

| Value | Meaning |
|-------|---------|
| `rpName` | Name shown in the OS passkey prompt. Defaults to the event name. |
| `rpId` | Bare domain, no scheme or port (`localhost`, `thriller-night.vercel.app`). **Leave blank to derive it from each request's own host**, which works unchanged in local dev and on Vercel. |
| `origins` | Full `scheme://host:port` URLs a ceremony may complete from. Leave empty to accept only the request's own origin; list several to cover dev and production at once. |

A passkey is permanently bound to the `rpId` it was created under, so
changing that value after guests have registered invalidates their
credentials. Leaving it blank avoids that class of mistake entirely.

Two constraints worth knowing before the party:

- **WebAuthn requires a secure context.** It works on `https://` and on
  `http://localhost`, but *not* over a bare LAN IP like
  `http://192.168.1.142:3001` — testing on a phone against a dev machine
  needs a tunnel (or just use the deployed site).
- **One credential per guest.** Each guest record gets exactly one passkey,
  which is what lets a parent register separately for themselves and for
  each child on the same phone. A guest whose passkey can't be used (wrong
  device, declined prompt, unsupported browser) is shown a retry and told
  to find an admin — see the admin fallback note in the Costume Voting
  section.

Picking a name is entirely self-asserted — nothing stops someone from
registering a passkey under a guest identity that isn't theirs the first
time around. To close that gap, a guest's **very first** passkey
registration (never a later login, and never the retry-a-stale-credential
recovery path above) is gated on the `phoneVerificationEnabled` toggle:

- **Guest has a phone on file, toggle on** — a one-time code is sent
  automatically to that on-file number (never typed in) before the
  registration ceremony starts. Once it checks out, registration proceeds
  and the guest is checked in immediately, same as today.
- **Guest has no phone on file, toggle on** — verification is skipped
  entirely and registration proceeds straight away, but the guest is
  flagged `pendingApprovalAt` (see the `Guests` tab above) instead of
  checked in. They still get full normal access — browsing, uploading a
  costume photo — until an admin resolves them on `/admin/check-in`:
  **Approve** checks them in, **Reject** deletes their passkey registration
  entirely so the real guest can register from scratch under their own
  name.
- **Toggle off** — the admin has opted out of verification altogether, so
  this never adds friction beyond what leaving it on would for a
  no-phone guest: registration proceeds straight to checked-in either way.

### 6. Admin access

There is no admin password and no separate admin login screen. Admin access
is just an authorization check layered on top of the guest identity
verification above: flag a guest `isAdmin` (`TRUE`, case-insensitive) in the
`Guests` tab's last column, and whoever is checked in as that guest — via
the exact same phone/passkey flow every other guest uses — sees an "Admin"
link on the home page and gets straight into `/admin` with no further
login step. Unflag it (clear the cell) to revoke access; it takes effect on
that guest's very next request, since nothing about admin status is cached
in a cookie of its own.

This is checked fresh, server-side, on every single admin page/API request
(`src/lib/auth/adminAccess.ts`) — never just a client-side toggle hiding the
link. Anyone who isn't the currently active, admin-flagged guest (including
a direct hit on an admin URL with no session at all) is redirected to `/`,
not shown any kind of login form.

There is deliberately no backup/break-glass password: if everyone with
`isAdmin` set is ever locked out, fix it directly in the spreadsheet — the
same place `isAdmin` is set in the first place.

### 7. Environment variables

Copy `.env.example` to `.env.local` and fill in the service account email,
private key, Sheet ID, the Drive OAuth client id/secret/refresh token and
photos folder id, the three Twilio values (see above — Drive and Twilio are
only needed for photo upload and voting respectively), and a random
`SESSION_SECRET`. On Vercel/Netlify, set the same variables in the
dashboard instead of committing a file.

### 8. Site config (event details, theme, toggles, categories)

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

Visit `/` for the public site and `/vote` for costume voting. There's no
separate admin URL to visit directly while signed out — check in as an
`isAdmin`-flagged guest from `/` and use the "Admin" link that appears (see
"Admin access" above).

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
4. Swap `theme.placeholderImage` the same way for the no-photo default —
   shown wherever a guest or group has no photo uploaded yet (the admin
   Guests page's list/grid views and photo control, the voting page's
   nominee carousel, and the "Your Group" panel), replacing what used to be
   a hardcoded 🎭 icon.
5. Swap `theme.themeImage` the same way for the theme-name graphic on the
   home page — the theme name (`event.themeName`) is represented by a
   custom SVG created fresh each year rather than as text, rendered via the
   shared `ThemeImage` component.

No component code should ever need to change for a re-theme — if it does,
that's a bug in the theming system, not an expected step.

## Costume Voting module (Phase 1)

- **Guest/nominee data entry**: `/admin/guests` — one unified page for the
  guest list and their photos (no separate Photos page). A list/photo-grid
  view toggle at the top; either view shows a three-state Status badge per
  guest — **Not Checked In** (default, muted outline), **Checked In**
  (`guest.checkedInAt` is set but they haven't voted yet, accent color), or
  **Voted** (unique voter identities from the votes data, not raw
  vote-record counts, primary color) — and clicking a guest in either view
  opens a full edit modal (first/last name, phone, bracket, photo
  add/replace, plus a read-only Source field). The add-guest form takes an
  optional phone number and an optional photo — a photo picked at creation
  time is held client-side and uploaded right after the new guest record is
  created (photo upload needs a guest id to attach to). Or use
  `/admin/import` to bulk-import an Evite CSV export — the importer maps
  Evite's columns to the app's guest shape, then requires the admin to
  assign a bracket per guest — Adult Male, Adult Female, Boy, or Girl
  (Evite doesn't export it) — before anything is written. Adding a future
  source format means writing a new mapper in `src/lib/csv-import/mappers/`
  — the parse/review/confirm flow doesn't change. `Guest.phone` is an
  admin-entered contact field, unrelated to (and never populated by) Twilio
  Verify's phone-verification flow below, which still never persists the
  phone number used to verify. Retained long-term for future RSVP messaging,
  it's AES-256-GCM-encrypted immediately before it's written to the Sheet
  and only decrypted server-side at the point of use (see
  `src/lib/data-access/google-sheets/phoneEncryption.ts` and
  `PHONE_ENCRYPTION_KEY` below) — the Sheet itself never holds a plaintext
  number.
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
  group. `/admin/groups` gives admins a rename + photo (re)assignment view.
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
  choosing one of the four brackets (required). The "Not you?" link next to
  the "Voting as X" banner opens the same name-picker rather than
  destructively logging out on click — picking a name only changes anything
  once it resolves (see the session model below), and canceling leaves the
  current session untouched. A browser's session cookie can actually hold
  more than one guest's verified session at once (see
  `src/lib/auth/voterSession.ts`): picking a name that already verified on
  this device switches to them immediately with no re-prompt; picking one
  that hasn't falls through to the normal phone/code verification, which
  adds them alongside whoever else already verified here rather than
  signing those guests out — this is what lets a parent verify themselves,
  vote, then verify a second time as their child on the same phone, and
  switch back afterward without re-verifying either one again.
- **Check-in**: a "Check In" button on the home page (`/`), separate from
  voting, opens the exact same name → phone → code verification flow
  (`VerifyIdentityModal`, reused as-is) and establishes the same session
  cookie voting checks — so a guest who checks in on arrival won't be
  re-prompted the first time they vote. The reverse also holds: verifying
  for the first time at vote-time counts as checking in too, since both
  paths call the same `POST /api/auth/phone/verify` endpoint, which is what
  actually marks a guest checked in (`DataStore.markGuestCheckedIn`, set
  once and kept on the first verification). The per-vote prompt is
  unchanged and still works on its own — e.g. a parent can verify a second
  time on the same device to vote for a child without their own phone.
- **Passkey login**: when the admin's **Passkey Login** toggle is on, the
  phone → code steps above are replaced by a WebAuthn ceremony
  (`/api/auth/passkey/begin` then `/finish`, backed by `@simplewebauthn`) —
  a registration the first time a guest picks their name, an authentication
  on every later visit. Everything else is identical: the same
  `VerifyIdentityModal`, the same session cookie, the same
  `markGuestCheckedIn`, the same multi-guest-per-browser behavior that lets
  a parent register separately for each child. Turning the toggle off
  restores the SMS flow exactly; neither strategy's code is removed for the
  other. See "Passkey login" under One-time setup for RP configuration.
- **Fallback when a passkey won't work** (declined prompt, unsupported
  browser, a guest on a device their passkey didn't sync to): the modal
  keeps them on the passkey step with a retry and tells them to find an
  admin. There is currently **no admin surface for casting a vote on
  another guest's behalf** — `POST /api/votes` always derives the voter from
  the session cookie and never accepts a guest id. Today's actual escape
  hatch is the admin toggles: switching **Passkey Login** off (and, if
  needed, **Phone Verification** off too) lets that guest pick their name
  and get straight in. That's global rather than per-guest, so a true
  per-guest admin vote-on-behalf tool is the obvious next addition.
- **Results**: `/vote/results` is a public reveal page that only shows real
  data once an admin publishes results from `/admin/voting`; the admin panel
  itself can always see live tallies while voting is open or closed. Results
  for the Couple/Group category show the group's name, not any member's.
- **Photos**: admin-tagged from `/admin/guests` (guests) or `/admin/groups`
  (groups), and the `POST /api/photos` endpoint (also used by the
  guest-facing group-photo upload in the "Your Group" panel) — all go
  through the same `PhotoStorage`/`DataStore` write path. Every photo is
  standardized to a
  4:5 portrait crop: whoever uploads gets a pan/zoom crop step
  (`src/components/PhotoCropModal.tsx`, canvas-based, no cropper
  dependency) before it saves, and the voting carousel additionally applies
  a CSS center-crop fallback (`aspect-[4/5]` + `object-cover`) so even a
  photo that predates this feature never shows blank space.

## Candy Count Contest

A second, deliberately separate contest — its own route (`/candy-count`),
own QR code entry point, own admin page (`/admin/candy-count`, not folded
into `/admin/voting`), own Sheets tab and Settings keys — that otherwise
mirrors the Costume Voting module's architecture end to end: same identity
flow, same upsert-on-resubmit pattern, same private-then-publish results
gate, same optional per-year prize-image config field.

- **Guessing**: `/candy-count` — identify yourself by name (`VerifyIdentityModal`,
  reused as-is — same passkey/SMS/skip-verify strategy the admin has chosen
  for voting), then submit a single whole-number guess for how many pieces
  of candy are in the jar. Submitting is gated on the same verified session
  cookie voting uses; browsing the page itself is always open. A repeat
  submission overwrites the guest's prior guess (`DataStore.recordCandyGuess`
  is an upsert keyed on guestId), not device-locked, same as costume voting.
  Every validation rule (whole number, non-negative, not absurdly large) is
  enforced both client-side, for instant feedback, and server-side in
  `POST /api/candy-count`, which never trusts the client's own check.
- **Tiebreaker**: the page states plainly that a tie for closest guess is
  resolved with a live rock-paper-scissors match at the party — this is
  informational copy only; the site surfaces that a tie exists and who's
  involved, but doesn't adjudicate it.
- **Admin controls**: `/admin/candy-count` has its own **Guessing Status**
  (Open/Closed) and **Results Visibility** (Published/Unpublished) toggles
  (`CandyCountStatusToggles.tsx`, the same Sheets-backed on/off pattern as
  `VotingStatusToggles.tsx`), plus a field to enter the actual candy count
  once it's known. Entering it doesn't publish anything by itself — the
  admin can privately check standings (`computeCandyResults`: ranks every
  guess by absolute difference from the true count, and surfaces every
  guess tied for closest as a `winners` array of length 1 in the normal
  case, 2+ when there's a tie) at any time, and a separate **Publish**
  action is what makes `/candy-count/results` show anything real to guests.
- **Results**: `/candy-count/results` is a public reveal page that only
  shows the real winner(s) once an admin publishes from `/admin/candy-count`
  — unpublished, it shows a placeholder with a running guess count, same as
  `/vote/results`. A tie renders every tied guess rather than picking one
  arbitrarily, with the same rock-paper-scissors framing as the guessing
  page's copy.
- **Prize image**: `candyCount.prizeImage` in site config, wired through
  `src/lib/config/index.ts` exactly like `voting.prizeImage` — optional, and
  the prize section on `/candy-count` is skipped entirely when unset.
- **Home page nav**: the landing page's button stack below Check-In
  (`src/components/HomeNavButtons.tsx`, rendering a list of
  `GatedNavButton`s — the generalized former `VoteButton`) is what future
  years extend for new features (a trivia contest, say) — one more
  conditional entry in the `navButtons` array in `src/app/page.tsx`, no
  layout changes needed. Each button is gated on check-in status the same
  way the old Vote button was, presentation-only — the destination page
  still gates its own submission server-side regardless.

## Privacy Policy

`src/app/privacy/page.tsx` (`/privacy`) is a static page describing what
guest data this app collects, why, who can see it, and how long it's kept —
written for what this actually is (a private, invite-only party, not a
public product). `src/components/SiteFooter.tsx` renders a "Privacy Policy"
link to it in a small footer on every page via the root layout
(`src/app/layout.tsx`), guest-facing and admin alike — `admin/layout.tsx`
has no `<html>`/`<body>` of its own, so it nests inside the same root
layout and gets the footer automatically.

The page also shows a self-hosted animated image (`public/images/rickroll.webp`
— originally a GIF, re-encoded as animated WebP for a much smaller file at
the same quality) with a "You've just been Rickrolled" caption banner
overlaid on it. A plain `<img>`/`next/image`
animated image just plays on its own the instant it loads, on every browser
and OS with zero permission/gesture/mute complications — deliberately
chosen over a video embed (an earlier YouTube IFrame Player API
implementation was tried and removed) specifically to sidestep mobile
autoplay policy entirely rather than work around it. `unoptimized` is set
on the `<Image>` so Next's image optimizer doesn't flatten it down to a
single static frame. Self-hosted rather than hotlinked from Giphy/Tenor —
one less external dependency/CSP allowance, and no rate limits or
third-party tracking on a page literally about privacy.

The contact address shown on the page is `event.contactEmail` in site
config (or `SITE_CONTACT_EMAIL`) — defaults to an obvious placeholder
(`REPLACE-ME@example.com`) if unset, same env-wins-over-file precedence as
everything else in `src/lib/config/index.ts`.

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
