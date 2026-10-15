import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getPhotoStorage } from "@/lib/photo-storage";
import { sanitizeFileNameComponent, sniffImageMimeType } from "@/lib/photo-storage/imageSniff";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { getSessionGuestId, getVoterSessionPayload, hasSessionFor } from "@/lib/auth/voterSession";
import { hasFullCheckInAccess } from "@/lib/auth/guestStatus";
import { isValidId } from "@/lib/validation";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Uploads and tags a costume photo for a guest OR a group (requirements
 * Section 5.3, plus group registration). Requires a signed-in session on
 * every request, and the session must be allowed to tag the named target —
 * the guestId/groupId in the form body is only ever the *target*, never
 * proof of who's asking:
 *
 * - An admin may upload for any guest or group, whatever their status, same
 *   as every other admin guest-management action.
 * - Otherwise the active session's guest must be fully checked in (not
 *   pending — see hasFullCheckInAccess), and:
 *   - for a guest: this browser must hold a verified session for that
 *     guest (the active one, or another on the same device — e.g. a parent
 *     who verified a child here), and that guest must be checked in too;
 *   - for a group: the active guest must be a member of it.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const guestId = formData?.get("guestId");
  const groupId = formData?.get("groupId");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "A photo file is required (form field 'file')." }, { status: 400 });
  }
  if (!isValidId(guestId) && !isValidId(groupId)) {
    return NextResponse.json({ error: "guestId or groupId is required." }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use JPEG, PNG, WEBP, or GIF." },
      { status: 400 },
    );
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: "Photo is too large (max 8MB)." }, { status: 400 });
  }

  // The check above only looked at the Content-Type the caller declared —
  // trivially spoofable (e.g. a raw multipart POST can label any bytes
  // "image/jpeg"). This looks at the file's actual signature instead, and
  // is what actually decides the mimeType Drive stores the file under
  // below, not file.type.
  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffedMimeType = sniffImageMimeType(buffer);
  if (!sniffedMimeType || !ALLOWED_MIME_TYPES.has(sniffedMimeType)) {
    return NextResponse.json(
      { error: "This file's content doesn't match a supported image format." },
      { status: 400 },
    );
  }

  const store = getDataStore();
  const isGroup = isValidId(groupId);

  const requesterId = await getSessionGuestId();
  if (!requesterId) {
    return NextResponse.json(
      { error: "Please check in before uploading a photo.", requiresVerification: true },
      { status: 401 },
    );
  }
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    const requester = await store.getGuestById(requesterId);
    if (!requester) {
      return NextResponse.json(
        { error: "Please check in before uploading a photo.", requiresVerification: true },
        { status: 401 },
      );
    }
    if (!hasFullCheckInAccess(requester)) {
      return NextResponse.json(
        { error: "Your check-in is still waiting on admin approval before you can upload a photo." },
        { status: 403 },
      );
    }
  }

  let targetId: string;
  if (isGroup) {
    const group = await store.getGroupById(groupId);
    if (!group) return NextResponse.json({ error: "Group not found." }, { status: 404 });
    if (!isAdmin && !group.memberIds.includes(requesterId)) {
      return NextResponse.json({ error: "You can only upload a photo for your own group." }, { status: 403 });
    }
    targetId = group.id;
  } else {
    if (!isValidId(guestId)) {
      return NextResponse.json({ error: "Guest not found." }, { status: 404 });
    }
    const guest = await store.getGuestById(guestId);
    if (!guest) return NextResponse.json({ error: "Guest not found." }, { status: 404 });
    if (!isAdmin) {
      if (guestId !== requesterId && !hasSessionFor(await getVoterSessionPayload(), guestId)) {
        return NextResponse.json({ error: "You can only upload your own photo." }, { status: 403 });
      }
      if (!hasFullCheckInAccess(guest)) {
        return NextResponse.json(
          { error: "That check-in is still waiting on admin approval before a photo can be uploaded." },
          { status: 403 },
        );
      }
    }
    targetId = guest.id;
  }

  const photoStorage = getPhotoStorage();

  let uploaded;
  try {
    uploaded = await photoStorage.uploadPhoto({
      fileName: `${targetId}-${Date.now()}-${sanitizeFileNameComponent(file.name)}`,
      mimeType: sniffedMimeType,
      data: buffer,
    });
  } catch (err) {
    // Logged server-side for diagnosis; the client only gets a generic
    // message, never the storage provider's raw error.
    console.error("Photo upload failed:", err);
    return NextResponse.json(
      { error: "Failed to upload photo. Please try again or contact an admin." },
      { status: 502 },
    );
  }

  try {
    if (isGroup) {
      await store.saveGroupPhotoReference(targetId, uploaded.ref, uploaded.url);
    } else {
      await store.savePhotoReference(targetId, uploaded.ref, uploaded.url);
    }
  } catch (err) {
    // The file itself uploaded fine, but we couldn't record it against the
    // guest/group — without this, it'd be an orphaned, silently-public file
    // sitting in Drive with nothing pointing at it. Best-effort delete it
    // rather than leave that behind; either way, report the original
    // failure since that's what the caller needs to retry.
    console.error("Failed to save photo reference after upload succeeded; deleting orphaned file:", err);
    try {
      await photoStorage.deletePhoto(uploaded.ref);
    } catch (cleanupErr) {
      console.error(`Failed to delete orphaned photo ${uploaded.ref}; needs manual cleanup:`, cleanupErr);
    }
    return NextResponse.json(
      { error: "Failed to upload photo. Please try again or contact an admin." },
      { status: 502 },
    );
  }

  return NextResponse.json({ photoRef: uploaded.ref, photoUrl: uploaded.url });
}
