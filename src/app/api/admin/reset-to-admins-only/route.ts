import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { revokeGuestSessions } from "@/lib/auth/sessionRevocation";
import { getPhotoStorage } from "@/lib/photo-storage";

/** A file that's already gone counts as deleted, so a re-run after an interruption doesn't report it as a failure. */
function isNotFound(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  return e?.code === 404 || e?.status === 404 || e?.response?.status === 404;
}

/**
 * Admin-only, destructive: "Reset to admins only" on /admin/security's
 * Danger Zone — the full pre-party reset. See DataStore.resetToAdminsOnly
 * for the steps (pause other writes, wipe in single batched writes, verify,
 * sign everyone out, resume). It never throws for a failed step; this
 * returns its report either way — 200 when everything finished, 500 with
 * the same report when it didn't — so the admin sees what was wiped and
 * what's left, and can simply run it again to finish.
 *
 * The in-memory revocation below is a same-instance belt-and-suspenders on
 * top of the store's persistent sign-out. The triggering admin's own
 * request was authorized above and still completes; their session is dead
 * from the next request on.
 */
export async function POST() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const photoStorage = getPhotoStorage();
  const report = await getDataStore().resetToAdminsOnly({
    deletePhoto: async (ref) => {
      try {
        await photoStorage.deletePhoto(ref);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  });
  for (const guestId of report.allGuestIds) {
    revokeGuestSessions(guestId);
  }

  return NextResponse.json(
    {
      ok: report.complete,
      ...report,
      allGuestIds: undefined, // internal; dropped from the JSON
      ...(report.complete ? {} : { error: "The reset didn't fully finish. Run it again to finish the rest." }),
    },
    { status: report.complete ? 200 : 500 },
  );
}
