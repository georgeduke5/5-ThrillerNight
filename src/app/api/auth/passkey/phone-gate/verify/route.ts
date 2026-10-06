import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { checkVerificationCode } from "@/lib/auth/twilioVerify";
import { normalizePhone } from "@/lib/auth/phoneFormat";
import { setPasskeyChallengeCookie } from "@/lib/auth/passkeyChallenge";
import { resolvePasskeyRelyingParty } from "@/lib/auth/passkeyRelyingParty";
import { buildPasskeyRegistrationOptions } from "@/lib/auth/passkeyRegistration";
import { isValidId } from "@/lib/validation";

/**
 * Checks the code sent by POST .../phone-gate/start and, on success, hands
 * back WebAuthn registration options in the exact same shape
 * POST /api/auth/passkey/begin does — the client continues with
 * startRegistration() and POST /api/auth/passkey/finish exactly as it
 * would for a normal first-time registration. This endpoint only ever
 * issues a plain first-time registration challenge, matching the gate this
 * closes: a guest with a phone on file must pass this check before any
 * registration ceremony begins. The `existing` check just below is this
 * route's own copy of the one-passkey-per-guest rule (see
 * GoogleSheetsDataStore.savePasskey) — redundant with /begin's, but this
 * route can be reached directly without going through /begin first.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string; code?: string } | null;
  const guestId = body?.guestId;
  const code = body?.code?.trim();
  if (!isValidId(guestId) || !code) {
    return NextResponse.json({ error: "guestId and code are required." }, { status: 400 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.passkeyAuthEnabled || !status.phoneVerificationEnabled) {
    return NextResponse.json({ error: "Phone verification is not enabled." }, { status: 403 });
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }
  if (!guest.phone) {
    return NextResponse.json({ error: "No phone number on file for this guest." }, { status: 400 });
  }

  const existing = await store.getPasskeyByGuestId(guestId);
  if (existing) {
    return NextResponse.json({ error: "This guest already has a passkey registered." }, { status: 409 });
  }

  let approved: boolean;
  try {
    approved = await checkVerificationCode(normalizePhone(guest.phone), code);
  } catch (err) {
    console.error("Failed to check phone-gate verification code:", err);
    return NextResponse.json({ error: "Failed to check verification code." }, { status: 502 });
  }
  if (!approved) {
    return NextResponse.json({ error: "Incorrect or expired code." }, { status: 401 });
  }

  const rp = resolvePasskeyRelyingParty(request);
  const options = await buildPasskeyRegistrationOptions(guest, rp);

  const response = NextResponse.json({ mode: "registration" as const, options });
  setPasskeyChallengeCookie(response, {
    guestId,
    challenge: options.challenge,
    ceremony: "registration",
  });
  return response;
}
