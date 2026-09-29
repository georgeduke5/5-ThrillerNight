import "server-only";
import { Readable } from "node:stream";
import { google, drive_v3 } from "googleapis";
import type { PhotoStorage, UploadPhotoInput, UploadedPhoto } from "../PhotoStorage";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example for the Google Drive setup.`,
    );
  }
  return value;
}

let driveClientPromise: Promise<drive_v3.Drive> | null = null;

async function buildClient(): Promise<drive_v3.Drive> {
  const clientId = requireEnv("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = requireEnv("GOOGLE_OAUTH_REFRESH_TOKEN");

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });

  return google.drive({ version: "v3", auth });
}

function getDriveClient(): Promise<drive_v3.Drive> {
  if (!driveClientPromise) driveClientPromise = buildClient();
  return driveClientPromise;
}

/**
 * True for the specific failure Google's OAuth token endpoint returns when
 * GOOGLE_OAUTH_REFRESH_TOKEN has been revoked or has expired — e.g. the
 * authorizing Google account changed its password, removed this app's
 * access at myaccount.google.com/permissions, or (common for an OAuth
 * client still in "Testing" publishing status) the token simply reached
 * Google's expiry window for test-user grants. This happens *before* any
 * Drive API call: googleapis transparently tries to mint a fresh access
 * token from the refresh token first, and that exchange is what's failing.
 * No file/size/type issue on this app's side produces this shape.
 */
function isInvalidGrantError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: unknown; response?: { data?: { error?: unknown } } };
  return e.response?.data?.error === "invalid_grant" || e.message === "invalid_grant";
}

/**
 * Re-throws a Drive API failure, replacing an expired/revoked refresh token
 * error with a clear, actionable message before it reaches the caller's
 * catch-all `console.error` — the raw error otherwise logs as a multi-hundred
 * -line redacted gaxios dump with the actual cause buried in
 * `response.data.error`, not stated anywhere in its top-level `.message`.
 */
function rethrowWithDiagnosis(err: unknown): never {
  if (isInvalidGrantError(err)) {
    throw new Error(
      "Google Drive upload failed: GOOGLE_OAUTH_REFRESH_TOKEN is invalid or has expired " +
        "(invalid_grant from oauth2.googleapis.com/token). Run `npm run drive:auth` to " +
        "obtain a fresh token, then update it in .env.local and in the production host's " +
        "environment variables (e.g. Vercel). See the README's Google Drive setup section.",
    );
  }
  throw err;
}

/**
 * Stores costume photos in a folder inside the event host's own personal
 * Google Drive (GOOGLE_DRIVE_PHOTOS_FOLDER_ID), uploading via OAuth as that
 * person (whichever Google account authorized GOOGLE_OAUTH_REFRESH_TOKEN —
 * see scripts/get-drive-refresh-token.mjs and the README), rather than via
 * the app's Sheets service account.
 *
 * This exists because a bare service account cannot own Drive files outside
 * a Google Workspace Shared Drive — confirmed directly against the Drive
 * API: creating a file with no parent fails with `storageQuotaExceeded`
 * ("Service Accounts do not have storage quota"), and writing into a
 * *personal* Drive folder merely shared with the service account fails the
 * same way, since the service account would still end up as the file's
 * owner. A personal Gmail account has no Shared Drives to fall back on
 * either (those are Workspace-only). Uploading via OAuth as the personal
 * account sidesteps all of that: the upload counts against that account's
 * own storage quota, and the account owns every file it uploads outright —
 * so, unlike the old service-account approach, there's no separate
 * "share this file with me" step needed after creation.
 *
 * Uploading (this class) only needs the narrow `drive.file` scope —
 * confirmed directly that it's enough to create a new file as a child of a
 * pre-existing folder (GOOGLE_DRIVE_PHOTOS_FOLDER_ID) even though that
 * scope can't independently read/list the folder as a resource. The OAuth
 * grant also includes read-only `drive.readonly` on top, purely so admin
 * tooling can look up pre-existing files by name (e.g. bulk-linking photos
 * you copy into the folder yourself, outside the app) — this class never
 * uses that. See the scope comment in scripts/get-drive-refresh-token.mjs.
 *
 * Each file is still made viewable by anyone with the link (unrelated to
 * ownership) so it can be rendered in the voting gallery without
 * guest-facing auth.
 */
export class GoogleDrivePhotoStorage implements PhotoStorage {
  async uploadPhoto({ fileName, mimeType, data }: UploadPhotoInput): Promise<UploadedPhoto> {
    const drive = await getDriveClient();
    const folderId = requireEnv("GOOGLE_DRIVE_PHOTOS_FOLDER_ID");

    let fileId: string | null | undefined;
    try {
      const createRes = await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { mimeType, body: Readable.from(data) },
        fields: "id",
      });
      fileId = createRes.data.id;

      if (!fileId) throw new Error("Google Drive upload did not return a file id.");

      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
      });
    } catch (err) {
      rethrowWithDiagnosis(err);
    }

    return {
      ref: fileId,
      url: `https://lh3.googleusercontent.com/d/${fileId}=s1200`,
    };
  }

  async deletePhoto(ref: string): Promise<void> {
    const drive = await getDriveClient();
    try {
      await drive.files.delete({ fileId: ref });
    } catch (err) {
      rethrowWithDiagnosis(err);
    }
  }
}
