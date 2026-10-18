/**
 * POST /api/admin/reset-to-admins-only returns the store's report either
 * way (200 when finished, 500 when not), revokes every guest's in-memory
 * session, and treats an already-deleted photo file as deleted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResetToAdminsOnlyReport } from "@/lib/data-access";

const counts = { guests: 0, votes: 0, candyGuesses: 0, passkeys: 0, groupsDeleted: 0, groupsCleaned: 0 };
let report: ResetToAdminsOnlyReport;
const deletePhoto = vi.fn(async (_ref: string) => {});
const revokeGuestSessions = vi.fn();
let photoResult: unknown;

vi.mock("@/lib/auth/adminAccess", () => ({ isAdminRequest: vi.fn(async () => true) }));
vi.mock("@/lib/auth/sessionRevocation", () => ({ revokeGuestSessions: (id: string) => revokeGuestSessions(id) }));
vi.mock("@/lib/photo-storage", () => ({ getPhotoStorage: () => ({ deletePhoto }) }));
vi.mock("@/lib/data-access", () => ({
  getDataStore: () => ({
    resetToAdminsOnly: async (options: { deletePhoto: (ref: string) => Promise<void> }) => {
      photoResult = await options.deletePhoto("gone-file").then(
        () => "deleted",
        (e: unknown) => e,
      );
      return report;
    },
  }),
}));

beforeEach(() => {
  revokeGuestSessions.mockClear();
  deletePhoto.mockReset();
  report = {
    complete: true,
    steps: [],
    wiped: { ...counts, photosDeleted: 0 },
    remaining: counts,
    photosNotDeleted: [],
    adminsKept: ["George Duke"],
    signedOut: true,
    allGuestIds: ["g1", "g2"],
  };
});

describe("POST /api/admin/reset-to-admins-only", () => {
  it("200 with the report when finished, and revokes every guest's sessions", async () => {
    const { POST } = await import("@/app/api/admin/reset-to-admins-only/route");
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, complete: true, adminsKept: ["George Duke"] });
    expect(body.allGuestIds).toBeUndefined();
    expect(revokeGuestSessions.mock.calls.map((c) => c[0])).toEqual(["g1", "g2"]);
  });

  it("500 with the same report, plus a run-it-again message, when it didn't finish", async () => {
    report = { ...report, complete: false, remaining: { ...counts, guests: 3 } };
    const { POST } = await import("@/app/api/admin/reset-to-admins-only/route");
    const res = await POST();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, remaining: { guests: 3 } });
    expect(body.error).toMatch(/run it again/i);
  });

  it("a photo file that's already gone counts as deleted; any other failure is passed on", async () => {
    deletePhoto.mockRejectedValueOnce(Object.assign(new Error("File not found"), { code: 404 }));
    const { POST } = await import("@/app/api/admin/reset-to-admins-only/route");
    await POST();
    expect(photoResult).toBe("deleted");

    deletePhoto.mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { code: 429 }));
    await POST();
    expect(photoResult).toBeInstanceOf(Error);
  });
});
