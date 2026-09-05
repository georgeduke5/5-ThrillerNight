#!/usr/bin/env node
// One-time setup: obtains a Google OAuth refresh token for the personal
// Google account that should own uploaded costume photos (see the "Google
// Drive (photo storage)" section of the README). Run this once locally,
// open the printed URL, sign in as that Google account, and approve access
// — the script then prints GOOGLE_OAUTH_REFRESH_TOKEN to paste into
// .env.local.
//
// Requires GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to already
// be set (in .env.local or the environment), from a "Desktop app" OAuth
// client created in Google Cloud Console for the same project as the
// service account used elsewhere in this app.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { google } from "googleapis";

function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.\n" +
      "Create an OAuth 2.0 Client ID (type: Desktop app) in Google Cloud Console\n" +
      "for the same project as your service account, then set both in .env.local\n" +
      "before running this script. See the README's Google Drive setup section.",
  );
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://localhost:${PORT}`;
const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  // drive.file (not the broader "drive" scope): the app can only ever
  // *create or modify* files it uploaded itself, never anything else in
  // your Drive. Confirmed directly that this scope is enough to create a
  // new file as a child of a pre-existing folder (GOOGLE_DRIVE_PHOTOS_FOLDER_ID)
  // even though it can't independently read/list that folder as a resource
  // — the restriction is on visibility into existing items, not on placing
  // a newly-created (and therefore in-scope) file inside one you already own.
  //
  // drive.readonly is added on top so admin tooling can also *look up*
  // pre-existing files (e.g. photos you copy into the folder yourself
  // outside the app) by name to link them to guests — read-only, so it
  // still can't modify or delete anything the app didn't create.
  scope: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.readonly"],
});

console.log("\nOpen this URL in a browser, and sign in with the Google account");
console.log("that should own uploaded costume photos:\n");
console.log(authUrl);
console.log("\nWaiting for you to approve access...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end("Authorization failed — see your terminal.");
    console.error(`Authorization denied: ${error}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.end("No authorization code received.");
    return;
  }

  res.end("Authorized! You can close this tab and return to your terminal.");
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh token was returned. This usually means this Google account already\n" +
        "granted this app access before. Revoke access at https://myaccount.google.com/permissions\n" +
        "and run this script again.",
    );
    process.exit(1);
    return;
  }

  console.log("\nSuccess! Add this to .env.local:\n");
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log();
});

server.listen(PORT);
