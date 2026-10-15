/**
 * POST /api/photos authorization: every upload needs a signed-in session,
 * and that session must be allowed to tag the named guest or group — the
 * form's guestId/groupId is only ever the target, never proof of who's
 * asking. Real route handler and real voterSession.ts; only the data layer,
 * photo storage, and next/headers' cookies() are faked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Group, Guest } from "@/lib/data-access";

let cookieJar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => (name in cookieJar ? { name, value: cookieJar[name] } : undefined),
  })),
}));

const ME = "00000000-0000-0000-0000-0000000000a1";
const OTHER = "00000000-0000-0000-0000-0000000000a2";
const PENDING = "00000000-0000-0000-0000-0000000000a3";
const ADMIN = "00000000-0000-0000-0000-0000000000a4";
const MY_GROUP = "00000000-0000-0000-0000-0000000000b1";
const OTHER_GROUP = "00000000-0000-0000-0000-0000000000b2";

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
    checkedInAt: "2026-10-31T19:00:00.000Z",
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

function makeGroup(id: string, memberIds: string[]): Group {
  return { id, name: "G", photoRef: null, photoUrl: null, memberIds, createdAt: "2026-01-01T00:00:00.000Z" };
}

let guests: Record<string, Guest>;
let groups: Record<string, Group>;
const savePhotoReference = vi.fn(async () => {});
const saveGroupPhotoReference = vi.fn(async () => {});
const uploadPhoto = vi.fn(async () => ({ ref: "ref-1", url: "https://example.test/p.png" }));

vi.mock("@/lib/data-access", () => ({
  getDataStore: () => ({
    getGuestById: async (id: string) => guests[id] ?? null,
    getGuests: async () => Object.values(guests),
    getGroupById: async (id: string) => groups[id] ?? null,
    getSessionInvalidationThresholds: async () => ({ sessionsInvalidBefore: null, allSessionsInvalidBefore: null }),
    savePhotoReference,
    saveGroupPhotoReference,
  }),
}));
vi.mock("@/lib/photo-storage", () => ({
  getPhotoStorage: () => ({ uploadPhoto, deletePhoto: vi.fn(async () => {}) }),
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function upload(target: { guestId?: string; groupId?: string }) {
  const form = new FormData();
  form.append("file", new File([PNG], "p.png", { type: "image/png" }));
  if (target.guestId) form.append("guestId", target.guestId);
  if (target.groupId) form.append("groupId", target.groupId);
  return new Request("http://localhost/api/photos", { method: "POST", body: form }) as never;
}

async function signInAs(...guestIds: string[]) {
  const { createVoterSessionToken } = await import("@/lib/auth/voterSession");
  let token: string | undefined;
  for (const id of guestIds) {
    const { getVoterSessionPayload } = await import("@/lib/auth/voterSession");
    cookieJar = token ? { tn_voter_session: token } : {};
    token = createVoterSessionToken(await getVoterSessionPayload(), id);
  }
  cookieJar = token ? { tn_voter_session: token } : {};
}

beforeEach(() => {
  cookieJar = {};
  guests = {
    [ME]: makeGuest({ id: ME }),
    [OTHER]: makeGuest({ id: OTHER }),
    [PENDING]: makeGuest({ id: PENDING, checkedInAt: null, pendingApprovalAt: "2026-10-31T19:30:00.000Z" }),
    [ADMIN]: makeGuest({ id: ADMIN, isAdmin: true }),
  };
  groups = { [MY_GROUP]: makeGroup(MY_GROUP, [ME]), [OTHER_GROUP]: makeGroup(OTHER_GROUP, [OTHER]) };
  savePhotoReference.mockClear();
  saveGroupPhotoReference.mockClear();
  uploadPhoto.mockClear();
});

describe("POST /api/photos authorization", () => {
  it("rejects a request with no session at all, before touching storage", async () => {
    const { POST } = await import("@/app/api/photos/route");
    const res = await POST(upload({ guestId: ME }));
    expect(res.status).toBe(401);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("lets a checked-in guest upload their own photo", async () => {
    await signInAs(ME);
    const { POST } = await import("@/app/api/photos/route");
    const res = await POST(upload({ guestId: ME }));
    expect(res.status).toBe(200);
    expect(savePhotoReference).toHaveBeenCalledWith(ME, "ref-1", "https://example.test/p.png");
  });

  it("refuses to tag a different guest this browser holds no session for", async () => {
    await signInAs(ME);
    const { POST } = await import("@/app/api/photos/route");
    const res = await POST(upload({ guestId: OTHER }));
    expect(res.status).toBe(403);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("allows another guest verified on this same browser (e.g. a parent and child)", async () => {
    await signInAs(OTHER, ME); // ME active, OTHER also verified here
    const { POST } = await import("@/app/api/photos/route");
    const res = await POST(upload({ guestId: OTHER }));
    expect(res.status).toBe(200);
  });

  it("blocks a pending guest, whatever target they name", async () => {
    await signInAs(PENDING);
    const { POST } = await import("@/app/api/photos/route");
    expect((await POST(upload({ guestId: PENDING }))).status).toBe(403);
    expect((await POST(upload({ guestId: ME }))).status).toBe(403);
    expect((await POST(upload({ groupId: MY_GROUP }))).status).toBe(403);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("only lets a guest tag a group they belong to", async () => {
    await signInAs(ME);
    const { POST } = await import("@/app/api/photos/route");
    expect((await POST(upload({ groupId: OTHER_GROUP }))).status).toBe(403);
    expect((await POST(upload({ groupId: MY_GROUP }))).status).toBe(200);
    expect(saveGroupPhotoReference).toHaveBeenCalledTimes(1);
  });

  it("lets an admin tag any guest or group, including a pending guest", async () => {
    await signInAs(ADMIN);
    const { POST } = await import("@/app/api/photos/route");
    expect((await POST(upload({ guestId: OTHER }))).status).toBe(200);
    expect((await POST(upload({ guestId: PENDING }))).status).toBe(200);
    expect((await POST(upload({ groupId: OTHER_GROUP }))).status).toBe(200);
  });
});

describe("getPendingApprovalCode", () => {
  it("is null when not pending, stable per request, and changes for a new request", async () => {
    const { getPendingApprovalCode } = await import("@/lib/auth/pendingApprovalCode");
    expect(getPendingApprovalCode({ id: ME, pendingApprovalAt: null })).toBeNull();
    const a = getPendingApprovalCode({ id: ME, pendingApprovalAt: "2026-10-31T19:30:00.000Z" });
    expect(a).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(getPendingApprovalCode({ id: ME, pendingApprovalAt: "2026-10-31T19:30:00.000Z" })).toBe(a);
    expect(getPendingApprovalCode({ id: ME, pendingApprovalAt: "2026-10-31T19:31:00.000Z" })).not.toBe(a);
  });
});
