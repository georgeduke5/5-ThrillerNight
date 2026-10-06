import "server-only";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import type { Guest } from "@/lib/data-access";
import type { PasskeyRelyingParty } from "./passkeyRelyingParty";

type PasskeyRegistrationOptions = Awaited<ReturnType<typeof generateRegistrationOptions>>;

/**
 * Builds WebAuthn registration options for a guest's ceremony. Shared by
 * /api/auth/passkey/begin (a guest with no phone on file) and
 * /api/auth/passkey/phone-gate/verify (a guest with a phone on file, once
 * their code checks out) so both start from the exact same ceremony shape.
 * Both call sites already confirmed this guest has no passkey on file
 * before reaching here — one-passkey-per-guest means there's never an
 * existing credential to exclude or replace.
 */
export async function buildPasskeyRegistrationOptions(
  guest: Guest,
  rp: PasskeyRelyingParty,
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
  });
}
