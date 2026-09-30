import "server-only";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import type { Guest, GuestPasskey } from "@/lib/data-access";
import type { PasskeyRelyingParty } from "./passkeyRelyingParty";

type PasskeyRegistrationOptions = Awaited<ReturnType<typeof generateRegistrationOptions>>;

/**
 * Builds WebAuthn registration options for a guest's ceremony. Shared by
 * /api/auth/passkey/begin (a guest with no phone on file, or the
 * retryAsRegistration recovery path) and
 * /api/auth/passkey/phone-gate/verify (a guest with a phone on file, once
 * their code checks out) so both start from the exact same ceremony shape.
 */
export async function buildPasskeyRegistrationOptions(
  guest: Guest,
  rp: PasskeyRelyingParty,
  existing: GuestPasskey | null,
): Promise<PasskeyRegistrationOptions> {
  const guestName = `${guest.firstName} ${guest.lastName}`.trim();
  return generateRegistrationOptions({
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
    // Only set when replacing a stale credential (retryAsRegistration) —
    // harmless if that credential turns out to still be present on this
    // device somehow, but prevents a confusing "you already have this one"
    // platform error in the more likely case that it's simply gone.
    excludeCredentials: existing
      ? [{ id: existing.credentialId, transports: existing.transports as AuthenticatorTransportFuture[] }]
      : undefined,
  });
}
