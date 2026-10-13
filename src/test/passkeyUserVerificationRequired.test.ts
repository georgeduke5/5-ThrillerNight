/**
 * A passkey must not be usable — for registration OR authentication —
 * without the device owner unlocking it biometrically or with their PIN.
 * WebAuthn's lever for this is userVerification: both the options a route
 * hands the browser (generateRegistrationOptions/generateAuthenticationOptions)
 * and the check the server runs on the signed-back response
 * (verifyRegistrationResponse/verifyAuthenticationResponse) have to agree
 * it's "required", not merely "preferred" — see passkeyRegistration.ts and
 * /api/auth/passkey/begin and /finish.
 *
 * @simplewebauthn/server itself is mocked (its own enforcement of
 * requireUserVerification is that library's concern, well outside this
 * app); what's verified here is that this app's own code actually asks for
 * it on every ceremony shape — a first-time registration with no phone on
 * file, one gated behind the on-file-phone SMS code, and an authentication
 * for a returning guest.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DataStore, Guest, GuestPasskey } from "@/lib/data-access";

let cookieJar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
  })),
}));

const generateRegistrationOptions = vi.fn(async (_opts: unknown) => ({
  challenge: "reg-challenge",
  rp: { id: "x", name: "x" },
  user: {},
}));
const generateAuthenticationOptions = vi.fn(async (_opts: unknown) => ({
  challenge: "auth-challenge",
  allowCredentials: [],
}));
const verifyRegistrationResponse = vi.fn(async (_opts: unknown) => ({
  verified: true,
  registrationInfo: {
    credential: { id: "new-cred", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: [] },
  },
}));
const verifyAuthenticationResponse = vi.fn(async (_opts: unknown) => ({
  verified: true,
  authenticationInfo: { newCounter: 1 },
}));
vi.mock("@/lib/auth/twilioVerify", () => ({
  sendVerificationCode: vi.fn(async () => {}),
  checkVerificationCode: vi.fn(async () => true),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: (opts: unknown) => generateRegistrationOptions(opts),
  generateAuthenticationOptions: (opts: unknown) => generateAuthenticationOptions(opts),
  verifyRegistrationResponse: (opts: unknown) => verifyRegistrationResponse(opts),
  verifyAuthenticationResponse: (opts: unknown) => verifyAuthenticationResponse(opts),
}));

function makeGuest(overrides: Partial<Guest>): Guest {
  return {
    id: "unset",
    firstName: "Test",
    lastName: "Guest",
    bracket: "adult-male",
    photoRef: null,
    photoUrl: null,
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    groupId: null,
    phone: null,
    checkedInAt: null,
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

const NO_PHONE_ID = "00000000-0000-0000-0000-00000000e001";
const WITH_PHONE_ID = "00000000-0000-0000-0000-00000000e002";
const RETURNING_ID = "00000000-0000-0000-0000-00000000e003";
const TEST_GATE_TOKEN = "test-gate-token";

let guestsById: Map<string, Guest>;
let passkeysByGuestId: Map<string, GuestPasskey>;
let fakeStore: DataStore;

vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

function makeFakeStore(): DataStore {
  return {
    getGuests: vi.fn(async () => [...guestsById.values()]),
    getGuestById: vi.fn(async (id: string) => guestsById.get(id) ?? null),
    findGuestByName: vi.fn(async () => null),
    addGuest: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    addGuests: vi.fn(async () => []),
    updateGuest: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    savePhotoReference: vi.fn(async () => {}),
    deleteGuest: vi.fn(async () => {}),
    markGuestCheckedIn: vi.fn(async () => {}),
    markGuestPendingApproval: vi.fn(async () => {}),
    approvePendingGuest: vi.fn(async () => {}),
    rejectPendingGuest: vi.fn(async () => {}),
    migratePlaintextPhones: vi.fn(async () => ({ migrated: 0, alreadyEncrypted: 0, skippedEmpty: 0 })),

    getGroups: vi.fn(async () => []),
    getGroupById: vi.fn(async () => null),
    addGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    addGuestToGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    removeGuestFromGroup: vi.fn(async () => {}),
    updateGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    deleteGroup: vi.fn(async () => {}),
    saveGroupPhotoReference: vi.fn(async () => {}),

    recordVote: vi.fn(async (v) => ({ ...v, timestamp: "2026-01-01T00:00:00.000Z" })),
    getVotes: vi.fn(async () => []),

    getPasskeyByGuestId: vi.fn(async (guestId: string) => passkeysByGuestId.get(guestId) ?? null),
    getPasskeyByCredentialId: vi.fn(async () => null),
    getPasskeys: vi.fn(async () => [...passkeysByGuestId.values()]),
    savePasskey: vi.fn(async (passkey: GuestPasskey) => {
      passkeysByGuestId.set(passkey.guestId, passkey);
    }),
    deletePasskey: vi.fn(async (guestId: string) => passkeysByGuestId.delete(guestId)),
    updatePasskeyCounter: vi.fn(async () => {}),

    getVotingStatus: vi.fn(async () => ({
      isOpen: true,
      resultsPublished: false,
      phoneVerificationEnabled: true,
      passkeyAuthEnabled: true,
      selfServiceWalkinEnabled: true,
      inPersonCheckInEnabled: true,
    })),
    setVotingOpen: vi.fn(async () => {}),
    setResultsPublished: vi.fn(async () => {}),
    setPhoneVerificationEnabled: vi.fn(async () => {}),
    setPasskeyAuthEnabled: vi.fn(async () => {}),
    setSelfServiceWalkinEnabled: vi.fn(async () => {}),
    setInPersonCheckInEnabled: vi.fn(async () => {}),

    recordCandyGuess: vi.fn(async (g) => ({ ...g, timestamp: "2026-01-01T00:00:00.000Z" })),
    getCandyGuesses: vi.fn(async () => []),
    getCandyGuessByGuestId: vi.fn(async () => null),

    getCandyCountStatus: vi.fn(async () => ({ guessingOpen: true, resultsPublished: false, trueCount: null })),
    setCandyGuessingOpen: vi.fn(async () => {}),
    setCandyResultsPublished: vi.fn(async () => {}),
    setCandyTrueCount: vi.fn(async () => {}),

    // Not what this suite is testing — just a precondition /begin and
    // /phone-gate/start now share. See checkInGate.test.ts for that gate's
    // own coverage.
    getCheckInGateToken: vi.fn(async () => TEST_GATE_TOKEN),
    setCheckInGateToken: vi.fn(async () => {}),

    clearVotesAndCandyGuesses: vi.fn(async () => ({ votesCleared: 0, guessesCleared: 0 })),
    deleteNonAdminPasskeys: vi.fn(async () => ({ deleted: 0, guestIds: [] })),
    getSessionsInvalidBefore: vi.fn(async () => null),
    setSessionsInvalidBefore: vi.fn(async () => {}),
    setAllSessionsInvalidBefore: vi.fn(async () => {}),
    getSessionInvalidationThresholds: vi.fn(async () => ({ sessionsInvalidBefore: null, allSessionsInvalidBefore: null })),
    resetToAdminsOnly: vi.fn(async () => ({
      guestsDeleted: 0,
      adminsKept: 0,
      votesCleared: 0,
      guessesCleared: 0,
      passkeysCleared: 0,
      allGuestIds: [],
    })),
  };
}

function jsonRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  cookieJar = { tn_checkin_gate: TEST_GATE_TOKEN };
  guestsById = new Map([
    [NO_PHONE_ID, makeGuest({ id: NO_PHONE_ID, firstName: "No", lastName: "Phone" })],
    [WITH_PHONE_ID, makeGuest({ id: WITH_PHONE_ID, firstName: "Has", lastName: "Phone", phone: "5555550123" })],
    [RETURNING_ID, makeGuest({ id: RETURNING_ID, firstName: "Return", lastName: "Ing" })],
  ]);
  passkeysByGuestId = new Map();
  fakeStore = makeFakeStore();
  generateRegistrationOptions.mockClear();
  generateAuthenticationOptions.mockClear();
  verifyRegistrationResponse.mockClear();
  verifyAuthenticationResponse.mockClear();
});

describe("Every registration options call requires user verification", () => {
  it("a first-time registration for a guest with no phone on file (direct /begin path)", async () => {
    const { POST } = await import("@/app/api/auth/passkey/begin/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/begin", { guestId: NO_PHONE_ID }));
    expect((await res.json()).mode).toBe("registration");
    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatorSelection: expect.objectContaining({ userVerification: "required" }) }),
    );
  });

  it("a first-time registration for a guest with a phone on file, after the SMS code checks out (phone-gate path)", async () => {
    const { POST: phoneGateVerify } = await import("@/app/api/auth/passkey/phone-gate/verify/route");
    const res = await phoneGateVerify(
      jsonRequest("http://localhost/api/auth/passkey/phone-gate/verify", { guestId: WITH_PHONE_ID, code: "123456" }),
    );
    expect((await res.json()).mode).toBe("registration");
    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ authenticatorSelection: expect.objectContaining({ userVerification: "required" }) }),
    );
  });
});

describe("Every authentication options call requires user verification", () => {
  it("a returning guest signing in with their existing passkey", async () => {
    passkeysByGuestId.set(RETURNING_ID, {
      guestId: RETURNING_ID,
      credentialId: "existing-cred",
      publicKey: "pk",
      counter: 0,
      transports: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const { POST } = await import("@/app/api/auth/passkey/begin/route");
    const res = await POST(jsonRequest("http://localhost/api/auth/passkey/begin", { guestId: RETURNING_ID }));
    expect((await res.json()).mode).toBe("authentication");
    expect(generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ userVerification: "required" }),
    );
  });
});

describe("/api/auth/passkey/finish always verifies with requireUserVerification: true", () => {
  async function completeChallenge(guestId: string, ceremony: "registration" | "authentication") {
    // /finish trusts the signed challenge cookie, not the request body, for
    // which guest/ceremony this is — set it directly rather than running a
    // full begin call, keeping this file focused on the verify-call shape.
    const { encodePasskeyChallenge } = await import("@/lib/auth/passkeyChallenge");
    cookieJar.tn_passkey_challenge = encodePasskeyChallenge({ guestId, challenge: "c", ceremony });
  }

  it("a registration ceremony", async () => {
    await completeChallenge(NO_PHONE_ID, "registration");
    const { POST } = await import("@/app/api/auth/passkey/finish/route");
    await POST(jsonRequest("http://localhost/api/auth/passkey/finish", { response: { id: "whatever" } }));
    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: true }),
    );
  });

  it("an authentication ceremony", async () => {
    passkeysByGuestId.set(RETURNING_ID, {
      guestId: RETURNING_ID,
      credentialId: "existing-cred",
      publicKey: Buffer.from(new Uint8Array([1, 2, 3])).toString("base64url"),
      counter: 0,
      transports: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await completeChallenge(RETURNING_ID, "authentication");
    const { POST } = await import("@/app/api/auth/passkey/finish/route");
    await POST(
      jsonRequest("http://localhost/api/auth/passkey/finish", { response: { id: "existing-cred" } }),
    );
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({ requireUserVerification: true }),
    );
  });
});
