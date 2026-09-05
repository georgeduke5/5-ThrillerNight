import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { getPhotoStorage } from "@/lib/photo-storage";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Uploads and tags a costume photo for a guest OR a group (requirements
 * Section 5.3, plus group registration). Public — either the guest/group
 * member themselves or an admin can call this; the target is identified by
 * guestId/groupId in the form body, not by who's making the request.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const guestId = formData?.get("guestId");
  const groupId = formData?.get("groupId");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "A photo file is required (form field 'file')." }, { status: 400 });
  }
  if ((typeof guestId !== "string" || !guestId) && (typeof groupId !== "string" || !groupId)) {
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

  const store = getDataStore();
  const isGroup = typeof groupId === "string" && !!groupId;

  let targetId: string;
  if (isGroup) {
    const group = await store.getGroupById(groupId as string);
    if (!group) return NextResponse.json({ error: "Group not found." }, { status: 404 });
    targetId = group.id;
  } else {
    const guest = await store.getGuestById(guestId as string);
    if (!guest) return NextResponse.json({ error: "Guest not found." }, { status: 404 });
    targetId = guest.id;
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const photoStorage = getPhotoStorage();

  let uploaded;
  try {
    uploaded = await photoStorage.uploadPhoto({
      fileName: `${targetId}-${Date.now()}-${file.name}`,
      mimeType: file.type,
      data: buffer,
    });
  } catch (err) {
    // Logged server-side for diagnosis; the client only gets a generic
    // message since this endpoint is public (see the doc comment above).
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
