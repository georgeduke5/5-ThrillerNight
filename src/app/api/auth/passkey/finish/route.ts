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
import { getGuestCheckInStatus } from "@/lib/auth/guestStatus";
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
import { PublicError } from "@/lib/errors";

/**
 * Stage two of the passkey flow, the counterpart to POST
 * /api/auth/phone/verify. Verifies whichever ceremony /begin started and,
 * on success, always issues the same signed voter-session cookie the SMS
 * path does, merged alongside any other guests already verified on this
 * browser — but check-in status itself depends on which ceremony this was:
 * see the pendingApproval logic below.
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
    // challenge so a retry starts cleanly rather than reusing it. Only a
    // PublicError's message (thrown deliberately below, or from the
    // DataStore) is ever shown as-is — anything else (a WebAuthn library
    // error, a raw Sheets API failure) could carry internal details and is
    // replaced with a generic message.
    const message = err instanceof PublicError ? err.message : "Passkey verification failed.";
    console.error("Passkey ceremony failed:", err);
    const failure = NextResponse.json({ error: message }, { status: 401 });
    failure.cookies.delete(PASSKEY_CHALLENGE_COOKIE);
    return failure;
  }

  // A registration ceremony here is always a genuine first-time one — one
  // passkey per guest means handleRegistration already rejected anything
  // else — so it decides between an immediate check-in and a
  // pending-approval flag, re-derived fresh rather than trusted from
  // anything the client or the challenge cookie said earlier:
  //  - a phone on file means /begin already routed this guest through the
  //    phone-gate before they ever reached a registration ceremony, so
  //    they're checked in immediately, same as today.
  //  - no phone on file means /begin skipped verification entirely (see
  //    Guest.pendingApprovalAt) — this is the identity gap closed here:
  //    they still get full site access via the session cookie below, just
  //    not "checked in," until an admin reviews them on /admin/check-in.
  //  - phoneVerificationEnabled off site-wide is treated as the admin
  //    opting out of verification altogether, so it must never produce
  //    *more* friction than leaving it on would for a no-phone guest —
  //    straight to checked-in either way.
  // An authentication ceremony (a returning guest signing back in) checks in
  // immediately too — UNLESS this guest is currently pending: re-proving an
  // identity is never the same as being authorized, so a pending guest who
  // successfully re-authenticates (e.g. the same device, same credential,
  // after losing their session cookie) stays pending. Without this guard, a
  // pending guest who already holds a credential (the no-phone registration
  // path) could silently regain full access just by signing back in, with
  // no admin ever having approved them.
  //
  // The registration branch needs the SAME guard: a guest can already be
  // pending here too, via a completely different route — the phone/give-up
  // fallback (see .../fallback/give-up) is a distinct user action offered
  // the moment a ceremony *fails*, and WebAuthn ceremonies are slow and
  // unreliable enough in practice (observed taking well over a minute to
  // settle on some devices) that a guest can tap through to "verify in
  // person" while their original prompt is still hanging in the
  // background, then have that original ceremony resolve successfully
  // afterward. Without this guard, markGuestCheckedIn would set checkedInAt
  // on a record whose pendingApprovalAt was never cleared — an inconsistent
  // state that reports "approved" (see getGuestCheckInStatus) and tells the
  // client they're fully verified, even though an admin never approved
  // them.
  if (pending.ceremony === "registration") {
    if (getGuestCheckInStatus(guest) === "pending") {
      // Leave it exactly as-is — same principle as the authentication
      // branch below.
    } else if (status.phoneVerificationEnabled && !guest.phone) {
      await store.markGuestPendingApproval(pending.guestId);
    } else {
      await store.markGuestCheckedIn(pending.guestId);
    }
  } else if (pending.ceremony === "authentication") {
    if (getGuestCheckInStatus(guest) !== "pending") {
      await store.markGuestCheckedIn(pending.guestId);
    }
  }

  // Re-read rather than trust local mutation above, so pendingApproval is
  // reported correctly for every ceremony branch.
  const finalGuest = await store.getGuestById(pending.guestId);
  const pendingApproval = finalGuest ? getGuestCheckInStatus(finalGuest) === "pending" : false;

  // Same merge-don't-replace behavior as the SMS path, so a parent who
  // verifies for a second child on the same phone doesn't sign the first
  // one out — see voterSession.ts.
  const existingPayload = await getVoterSessionPayload();

  const response = NextResponse.json({ ok: true, guestId: pending.guestId, pendingApproval });
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
): Promise<void> {
  const store = getDataStore();

  // One passkey per guest, with no exception: re-checked here at
  // verification time, not just at /begin, so two ceremonies started in
  // parallel for the same guest (or a challenge issued before an admin's
  // "Remove Passkey" and completed after a *different* new registration)
  // can't both land a credential — whichever /finish call gets here first
  // wins. savePasskey below enforces this same rule one more time, as
  // close to the actual write as this architecture allows (see its own
  // comment) — this check here is what produces the specific, early,
  // guest-appropriate error; that one is the last-resort backstop.
  if (await store.getPasskeyByGuestId(guestId)) {
    throw new PublicError("This guest already has a passkey registered.");
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
    throw new PublicError("Passkey registration could not be verified.");
  }

  const { credential } = verification.registrationInfo;

  // Guards the one-credential-per-guest model from the other direction: the
  // same physical authenticator must not end up registered to two different
  // guests, which would let either name assert as the other.
  const claimedElsewhere = await store.getPasskeyByCredentialId(credential.id);
  if (claimedElsewhere && claimedElsewhere.guestId !== guestId) {
    throw new PublicError("That passkey is already registered to a different guest.");
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
    throw new PublicError("No passkey is registered for this guest.");
  }
  // The assertion must come from *this guest's* credential — without this,
  // a guest holding their own valid passkey could select someone else's
  // name and authenticate as them.
  if (stored.credentialId !== response.id) {
    throw new PublicError("That passkey belongs to a different guest.");
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
    throw new PublicError("Passkey verification failed.");
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
