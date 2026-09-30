import { NextRequest, NextResponse } from "next/server";
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getDataStore } from "@/lib/data-access";
import type { GuestPasskey } from "@/lib/data-access";
import {
  PASSKEY_CHALLENGE_COOKIE,
  getPasskeyChallenge,
} from "@/lib/auth/passkeyChallenge";
import { resolvePasskeyRelyingParty } from "@/lib/auth/passkeyRelyingParty";
import {
  VOTER_SESSION_COOKIE,
  VOTER_SESSION_MAX_AGE_SECONDS,
  createVoterSessionToken,
  getVoterSessionPayload,
} from "@/lib/auth/voterSession";

/**
 * Stage two of the passkey flow, the counterpart to POST
 * /api/auth/phone/verify. Verifies whichever ceremony /begin started and,
 * on success, ends in exactly the same place the SMS path does: the guest
 * is marked checked in and gets the same signed voter-session cookie,
 * merged alongside any other guests already verified on this browser.
 *
 * Which ceremony to verify — and for which guest — comes from the signed
 * challenge cookie, never the request body, so neither can be swapped by
 * the caller.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    response?: RegistrationResponseJSON | AuthenticationResponseJSON;
  } | null;
  const ceremonyResponse = body?.response;
  if (!ceremonyResponse) {
    return NextResponse.json({ error: "Missing passkey response." }, { status: 400 });
  }

  const pending = await getPasskeyChallenge();
  if (!pending) {
    return NextResponse.json(
      { error: "Your passkey request expired. Please try again." },
      { status: 400 },
    );
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.passkeyAuthEnabled) {
    return NextResponse.json({ error: "Passkey login is not enabled." }, { status: 403 });
  }

  const guest = await store.getGuestById(pending.guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  const rp = resolvePasskeyRelyingParty(request);

  try {
    if (pending.ceremony === "registration") {
      await handleRegistration(
        ceremonyResponse as RegistrationResponseJSON,
        pending.guestId,
        pending.challenge,
        rp.origins,
        rp.rpId,
        !!pending.allowOverwrite,
      );
    } else {
      await handleAuthentication(
        ceremonyResponse as AuthenticationResponseJSON,
        pending.guestId,
        pending.challenge,
        rp.origins,
        rp.rpId,
      );
    }
  } catch (err) {
    // A failed ceremony is an ordinary outcome here (wrong device, replayed
    // assertion, a credential that belongs to someone else), not a server
    // fault — surface it as a 401 the modal can show, and clear the spent
    // challenge so a retry starts cleanly rather than reusing it.
    const message = err instanceof Error ? err.message : "Passkey verification failed.";
    console.error("Passkey ceremony failed:", err);
    const failure = NextResponse.json({ error: message }, { status: 401 });
    failure.cookies.delete(PASSKEY_CHALLENGE_COOKIE);
    return failure;
  }

  await store.markGuestCheckedIn(pending.guestId);

  // Same merge-don't-replace behavior as the SMS path, so a parent who
  // verifies for a second child on the same phone doesn't sign the first
  // one out — see voterSession.ts.
  const existingPayload = await getVoterSessionPayload();

  const response = NextResponse.json({ ok: true, guestId: pending.guestId });
  response.cookies.set(
    VOTER_SESSION_COOKIE,
    createVoterSessionToken(existingPayload, pending.guestId),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: VOTER_SESSION_MAX_AGE_SECONDS,
      path: "/",
    },
  );
  // One challenge, one ceremony.
  response.cookies.delete(PASSKEY_CHALLENGE_COOKIE);
  return response;
}

async function handleRegistration(
  response: RegistrationResponseJSON,
  guestId: string,
  expectedChallenge: string,
  expectedOrigin: string[],
  expectedRPID: string,
  allowOverwrite: boolean,
): Promise<void> {
  const store = getDataStore();

  // Re-checked at verification time, not just at /begin: two ceremonies
  // started in parallel for the same guest must not both get to write a
  // credential, and a guest who registered in between would otherwise have
  // their existing passkey silently replaced. allowOverwrite is the one
  // deliberate exception — it comes from the signed challenge cookie
  // (never the request body), so it can only be true if /begin itself
  // decided this was a legitimate retryAsRegistration recovery, not
  // something a caller can set by relabeling this request.
  if (!allowOverwrite && (await store.getPasskeyByGuestId(guestId))) {
    throw new Error("This guest already has a passkey registered.");
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    // See the userVerification note in /begin — "preferred" there, so the
    // check here must not hard-require it.
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey registration could not be verified.");
  }

  const { credential } = verification.registrationInfo;

  // Guards the one-credential-per-guest model from the other direction: the
  // same physical authenticator must not end up registered to two different
  // guests, which would let either name assert as the other.
  const claimedElsewhere = await store.getPasskeyByCredentialId(credential.id);
  if (claimedElsewhere && claimedElsewhere.guestId !== guestId) {
    throw new Error("That passkey is already registered to a different guest.");
  }

  const passkey: GuestPasskey = {
    guestId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: credential.transports ?? [],
    createdAt: new Date().toISOString(),
  };
  await store.savePasskey(passkey);
}

async function handleAuthentication(
  response: AuthenticationResponseJSON,
  guestId: string,
  expectedChallenge: string,
  expectedOrigin: string[],
  expectedRPID: string,
): Promise<void> {
  const store = getDataStore();
  const stored = await store.getPasskeyByGuestId(guestId);
  if (!stored) {
    throw new Error("No passkey is registered for this guest.");
  }
  // The assertion must come from *this guest's* credential — without this,
  // a guest holding their own valid passkey could select someone else's
  // name and authenticate as them.
  if (stored.credentialId !== response.id) {
    throw new Error("That passkey belongs to a different guest.");
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin,
    expectedRPID,
    requireUserVerification: false,
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
      counter: stored.counter,
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) {
    throw new Error("Passkey verification failed.");
  }

  // Authenticators that implement a counter increment it every assertion; a
  // value that didn't move is how a cloned/replayed credential shows up.
  // Many passkey providers (iCloud Keychain, Google Password Manager) always
  // report 0, so only a real increment is persisted.
  const { newCounter } = verification.authenticationInfo;
  if (newCounter > stored.counter) {
    await store.updatePasskeyCounter(guestId, newCounter);
  }
}
