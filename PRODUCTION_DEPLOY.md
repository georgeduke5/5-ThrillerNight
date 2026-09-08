# Production Deployment Checklist

## Audit Results (verified by reading source files)

### ✅ #1 — No hardcoded dev credentials in source code

Every Google Sheet ID, Drive folder ID, OAuth credential, and Twilio credential flows
through a `requireEnv()` helper that **throws a hard error** (no fallback, no default)
if the variable is absent. Verified in:

- `src/lib/data-access/google-sheets/sheetsClient.ts` — `requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL")`, `requireEnv("GOOGLE_PRIVATE_KEY")`, `requireEnv("GOOGLE_SHEET_ID")`
- `src/lib/photo-storage/google-drive/GoogleDrivePhotoStorage.ts` — `requireEnv("GOOGLE_OAUTH_CLIENT_ID")`, `requireEnv("GOOGLE_OAUTH_CLIENT_SECRET")`, `requireEnv("GOOGLE_OAUTH_REFRESH_TOKEN")`, `requireEnv("GOOGLE_DRIVE_PHOTOS_FOLDER_ID")`
- `src/lib/auth/twilioVerify.ts` — `requireEnv("TWILIO_ACCOUNT_SID")`, `requireEnv("TWILIO_AUTH_TOKEN")`, `requireEnv("TWILIO_VERIFY_SERVICE_SID")`

Switching environments is purely a Vercel dashboard operation — no code changes needed.

### ✅ #2 — ADMIN_PASSWORD and SESSION_SECRET have no hardcoded fallbacks

Both are read with a throw-on-missing pattern, no `||`/`??` defaults anywhere:

- `adminSession.ts`: `getSessionSecret()` throws `"Missing required environment variable: SESSION_SECRET."` if absent; `verifyAdminPassword()` throws `"Missing required environment variable: ADMIN_PASSWORD."` if absent.
- `voterSession.ts`: same `getSessionSecret()` pattern, same throw.

The `.env.example` placeholder values (`change-me`, `change-me-too`) are only in the example file — they are never read by any source file.

### ✅ #3 — Security headers are correctly conditioned on environment

Verified in `next.config.mjs`:

- `isProd = process.env.NODE_ENV === "production"` — standard Next.js convention; Vercel sets this automatically.
- `script-src` drops `'unsafe-eval'` in production (only needed for Next.js HMR in dev). Correct.
- `Strict-Transport-Security` is only appended in the `if (isProd)` block. Correct.
- No localhost URL appears in any header value. The `img-src` hosts (`drive.google.com`, `lh3.googleusercontent.com`) are permanent Google domains.
- `allowedDevOrigins: ["192.168.1.142"]` is a Next.js dev-server-only key (used for LAN hot reload); it is never read in production builds and poses no production risk.

### ✅ #4 — No production code assumes localhost or a fixed port

Checked every auth route, cookie setter, and URL constructor:

- **Cookie `secure` flag**: both `api/admin/login/route.ts` and `api/auth/phone/verify/route.ts` use `secure: process.env.NODE_ENV === "production"`. Cookies will be HTTPS-only on Vercel automatically.
- **Cookie `domain`**: not set anywhere — cookies are implicitly scoped to whatever domain serves the response. Works correctly on any Vercel domain or custom domain.
- **No CORS origin list** in any route handler. The API is same-origin only.
- **No redirect URLs** constructed with `localhost` in any production code path.
- `scripts/get-drive-refresh-token.mjs` uses `http://localhost:53682` as the OAuth redirect URI — this is a **one-time developer script** run locally to obtain a refresh token; the app itself never uses this URL. Acceptable.
- `package.json` dev script binds to port 3001 — dev only, irrelevant in production.

**Nothing requires code changes before deploying.**

---

## Step-by-Step Production Setup Checklist

Work through these in order. Check each box as you complete it.

---

### Part 1 — Google Cloud project

- [ ] **Reuse your existing Google Cloud project** (the one that already has the Sheets API and your service account). You do not need a second project — the same project, service account, and OAuth client can be used with a fresh Sheet and fresh Drive folder.

---

### Part 2 — Production Google Sheet

- [ ] Open your dev Google Sheet and go to **File → Make a copy**. This gives you a structurally identical spreadsheet with all four tabs and their header rows intact. Alternatively, create a blank spreadsheet and add the four tabs manually (see structure below).
- [ ] Delete all data rows from every tab in the copy — leave only the header rows in row 1.
- [ ] Note the new spreadsheet's ID from its URL: `https://docs.google.com/spreadsheets/d/<THIS-IS-THE-ID>/edit`.
- [ ] **Share the new spreadsheet** with your service account email (`GOOGLE_SERVICE_ACCOUNT_EMAIL` from your dev `.env.local`) as an **Editor**. The service account does not change — only the Sheet ID changes.

#### Required tab structure (header row = row 1, exact spelling matters)

| Tab name | Row 1 headers (left to right) |
|---|---|
| `Guests` | `id`, `firstName`, `lastName`, `bracket`, `photoRef`, `photoUrl`, `source`, `createdAt`, `groupId`, `phone`, `checkedInAt` |
| `Votes` | `voterGuestId`, `category`, `nomineeId`, `timestamp` |
| `Groups` | `id`, `name`, `photoRef`, `photoUrl`, `memberIds`, `createdAt` |
| `Settings` | `key`, `value` |

---

### Part 3 — Production Google Drive folder

- [ ] In the Google account that will own production photos (the same one you authorized for dev, or a different one if you want a clean separation), create a new folder in Google Drive named something like `ThrillerNight 2026 Photos – Production`.
- [ ] Copy the folder ID from its URL: `https://drive.google.com/drive/folders/<THIS-IS-THE-FOLDER-ID>`.

---

### Part 4 — Production OAuth refresh token

The `scripts/get-drive-refresh-token.mjs` script is always run locally — it opens a browser, you sign in, and it prints a refresh token you paste into Vercel. You need a new token that grants access to the production Drive folder's owner account.

- [ ] In Google Cloud Console, open your OAuth 2.0 Client ID (type: **Desktop app**). Confirm `http://localhost:53682` is listed as an authorized redirect URI (it must be, since you ran this script before for dev). If not, add it.
- [ ] In your local `.env.local`, temporarily set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` to the production OAuth client values (they are likely the same client you already have).
- [ ] Run:
  ```
  npm run drive:auth
  ```
- [ ] Open the printed URL in a browser. **Sign in as the Google account that owns the production Drive folder** (important: sign in as that account, not your dev account, if they differ).
- [ ] Approve the requested permissions.
- [ ] Copy the printed `GOOGLE_OAUTH_REFRESH_TOKEN=...` value. This is your production refresh token — save it somewhere safe; you will paste it into Vercel in Part 6.
- [ ] If you signed in as a different account than dev, **revert your local `.env.local`** back to dev credentials so local dev continues to work.

> **Note:** If the script says "no refresh token was returned," the Google account already authorized this OAuth client previously. Revoke access at https://myaccount.google.com/permissions, then re-run the script.

---

### Part 5 — Twilio

- [ ] Decide whether to use your existing Twilio account or a separate production one.
  - **Same account**: you can reuse the existing Verify Service SID, or create a new Verify Service in the Twilio Console for cleaner separation. Either works.
  - **New account**: create the account, create a Verify Service, copy all three values.
- [ ] Confirm the Verify Service's **country permissions** include the US (and any other countries your guests will be calling from).
- [ ] Note: Twilio Verify charges per verification attempt (~$0.05 USD each). Make sure the production account has billing configured.

---

### Part 6 — Vercel environment variables

In your Vercel project dashboard → **Settings → Environment Variables**, add every variable below for the **Production** environment. Use the production values, not your dev values.

| Variable | What to set |
|---|---|
| `DATA_STORE_PROVIDER` | `google-sheets` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Your service account email (same as dev) |
| `GOOGLE_PRIVATE_KEY` | The full private key with literal `\n` sequences (same as dev — copy from `.env.local`) |
| `GOOGLE_SHEET_ID` | The **production** Sheet ID from Part 2 |
| `PHOTO_STORAGE_PROVIDER` | `google-drive` |
| `GOOGLE_OAUTH_CLIENT_ID` | Your OAuth client ID (same as dev) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Your OAuth client secret (same as dev) |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | The **production** token from Part 4 |
| `GOOGLE_DRIVE_PHOTOS_FOLDER_ID` | The **production** folder ID from Part 3 |
| `TWILIO_ACCOUNT_SID` | Production Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Production Twilio Auth Token |
| `TWILIO_VERIFY_SERVICE_SID` | Production Twilio Verify Service SID |
| `ADMIN_PASSWORD` | A **new, strong password** — different from your dev password |
| `SESSION_SECRET` | A **new random 32-byte hex string** — generate with `openssl rand -hex 32` — different from dev |

**Optional** (only needed if you want to override `config/site.config.json` values via env instead of the file):

| Variable | Example |
|---|---|
| `SITE_EVENT_NAME` | `Thriller Night 2026` |
| `SITE_EVENT_THEME_NAME` | `Silence of the Lambs` |
| `SITE_EVENT_DATE` | `2026-10-17` |
| `SITE_EVENT_ARRIVAL_TIME` | `6:00 PM` |
| `SITE_EVENT_END_TIME` | `11:00 PM` |
| `SITE_EVENT_TAGLINE` | `Enjoy Some Fava Beans And A Nice Chianti.` |
| `SITE_INVITATION_MODULE_ENABLED` | `false` |
| `SITE_VOTING_MODULE_ENABLED` | `true` |

> **GOOGLE_PRIVATE_KEY tip:** In Vercel's env var editor, paste the key exactly as it appears in `.env.local` (including the surrounding quotes and the literal `\n` sequences). Vercel stores the value verbatim; the app unescapes `\n` → real newlines at runtime.

---

### Part 7 — Deploy and verify

- [ ] Push to your production branch (or trigger a manual deploy in Vercel).
- [ ] Once deployed, open the production URL and confirm the home page loads.
- [ ] Open `/admin` and log in with the **production** `ADMIN_PASSWORD` — confirm you can reach the admin panel.
- [ ] In the admin panel, confirm the Guests tab is empty (fresh Sheet).
- [ ] Add a test guest manually.
- [ ] Upload a photo for that guest — confirm the photo appears and the Drive folder now contains it.
- [ ] Check in the test guest (enter their name on the home page, verify a phone number via SMS).
- [ ] Confirm the SMS is received from Twilio.
- [ ] Open voting, cast a test vote, confirm it appears in the Votes tab of the Sheet.
- [ ] Delete the test guest from the admin panel before the event.

---

### Part 8 — Keep dev credentials separate

Your local `.env.local` is gitignored and unchanged. Local dev continues to point at the dev Sheet, dev Drive folder, and dev Twilio account. No code changes were made — the only thing that differs between environments is which values Vercel has vs. what `.env.local` has.
