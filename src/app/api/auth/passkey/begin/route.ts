import { NextRequest, NextResponse } from "next/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { getDataStore } from "@/lib/data-access";
import {
  PASSKEY_CHALLENGE_COOKIE,
  PASSKEY_CHALLENGE_MAX_AGE_SECONDS,
  encodePasskeyChallenge,
} from "@/lib/auth/passkeyChallenge";
import { resolvePasskeyRelyingParty } from "@/lib/auth/passkeyRelyingParty";

/**
 * Stage one of the passkey flow, the counterpart to POST
 * /api/auth/phone/start. Given the guest just picked from the name
 * dropdown, decides on the server which ceremony they need — registration
 * the first time, authentication once they have a credential on file — and
 * returns the matching options for the browser to hand to WebAuthn.
 *
 * The client never says which ceremony it wants: that decision, and the
 * challenge behind it, are signed into a short-lived cookie (see
 * passkeyChallenge.ts) and read back from there at /finish, so a caller
 * can't register over a guest who already has a credential by relabeling
 * the request.
 *
 * `passkeyAuthEnabled` is re-read here on every call rather than trusted
 * from the client, mirroring how /api/auth/phone/skip-verify re-checks its
 * own kill switch — a stale tab can't drive a flow the admin has switched
 * off.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!guestId) {
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
  const guestName = `${guest.firstName} ${guest.lastName}`.trim();

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
    setChallengeCookie(response, guestId, options.challenge, "authentication");
    return response;
  }

  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpId,
    userName: guestName,
    userDisplayName: guestName,
    // The guest's own row id, so a parent registering separately for each
    // child on one device gets a distinct credential per child rather than
    // overwriting one shared entry.
    userID: new TextEncoder().encode(guest.id),
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });

  const response = NextResponse.json({ mode: "registration" as const, options });
  setChallengeCookie(response, guestId, options.challenge, "registration");
  return response;
}

function setChallengeCookie(
  response: NextResponse,
  guestId: string,
  challenge: string,
  ceremony: "registration" | "authentication",
): void {
  response.cookies.set(
    PASSKEY_CHALLENGE_COOKIE,
    encodePasskeyChallenge({ guestId, challenge, ceremony }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: PASSKEY_CHALLENGE_MAX_AGE_SECONDS,
      path: "/",
    },
  );
}
