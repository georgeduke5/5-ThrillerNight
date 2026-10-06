import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { getDataStore } from "@/lib/data-access";
import { setPasskeyChallengeCookie } from "@/lib/auth/passkeyChallenge";
import { resolvePasskeyRelyingParty } from "@/lib/auth/passkeyRelyingParty";
import { buildPasskeyRegistrationOptions } from "@/lib/auth/passkeyRegistration";
import { isValidId } from "@/lib/validation";

/**
 * Stage one of the passkey flow, the counterpart to POST
 * /api/auth/phone/start. Given the guest just picked from the name
 * dropdown, decides on the server which ceremony they need — registration
 * the first time, authentication once they have a credential on file — and
 * returns the matching options for the browser to hand to WebAuthn.
 *
 * One passkey per guest, enforced here unconditionally: a guest who already
 * has a credential on file always gets an authentication challenge, never a
 * registration one — there is no client-suppliable way to ask for
 * registration again instead (see GoogleSheetsDataStore.savePasskey and
 * DELETE /api/guests/[id]/passkey, the only way to clear an existing
 * credential). The client never says which ceremony it wants on any call:
 * that decision, and the challenge behind it, are signed into a
 * short-lived cookie (see passkeyChallenge.ts) and read back from there at
 * /finish, so a caller can't register over a guest who already has a
 * credential by relabeling the request.
 *
 * `passkeyAuthEnabled` is re-read here on every call rather than trusted
 * from the client, mirroring how every other check-in method's route
 * re-checks its own toggle (.../phone/start, .../phone/verify,
 * .../passkey/fallback/give-up) — a stale tab can't drive a flow the admin
 * has switched off.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!isValidId(guestId)) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.passkeyAuthEnabled) {
    return NextResponse.json({ error: "Passkey login is not enabled." }, { status: 403 });
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  const rp = resolvePasskeyRelyingParty(request);
  const existing = await store.getPasskeyByGuestId(guestId);

  // userVerification is "preferred" rather than "required" so an
  // authenticator without a biometric/PIN still works; /finish correspondingly
  // passes requireUserVerification: false. The signature already proves this
  // device holds the guest's credential, which is the property this flow
  // actually needs — a costume vote doesn't warrant locking out a guest
  // whose phone can't do Face ID.
  if (existing) {
    const options = await generateAuthenticationOptions({
      rpID: rp.rpId,
      userVerification: "preferred",
      allowCredentials: [
        {
          id: existing.credentialId,
          transports: existing.transports as AuthenticatorTransportFuture[],
        },
      ],
    });

    const response = NextResponse.json({ mode: "authentication" as const, options });
    setPasskeyChallengeCookie(response, { guestId, challenge: options.challenge, ceremony: "authentication" });
    return response;
  }

  // Reached only for a genuine first-time registration (existing is
  // falsy) — the only case this gate (or a registration ceremony at all)
  // ever applies to.
  if (status.phoneVerificationEnabled && guest.phone) {
    // The client never learns the phone number itself — it just knows one
    // is on file — and must go through POST .../phone-gate/start and
    // .../phone-gate/verify instead of registering directly here. A guest
    // with no phone on file, or with this kill switch off, skips straight
    // past this and registers below exactly as before; /finish is what
    // decides whether that means an immediate check-in or a pending-approval
    // flag (see Guest.pendingApprovalAt).
    return NextResponse.json({ mode: "phone-required" as const });
  }

  const options = await buildPasskeyRegistrationOptions(guest, rp);

  const response = NextResponse.json({ mode: "registration" as const, options });
  setPasskeyChallengeCookie(response, { guestId, challenge: options.challenge, ceremony: "registration" });
  return response;
}
