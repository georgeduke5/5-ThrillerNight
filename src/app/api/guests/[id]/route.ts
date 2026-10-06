import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";
import { getSessionGuestId } from "@/lib/auth/voterSession";
import { isPlausiblePhone } from "@/lib/auth/phoneFormat";
import { isValidId, isValidShortText } from "@/lib/validation";
import type { GuestBracket } from "@/lib/config/types";

function isValidBracket(value: unknown): value is GuestBracket {
  return value === "adult-male" || value === "adult-female" || value === "boy" || value === "girl";
}

/**
 * Admin edit (any guest), or a guest editing their own record from the
 * "Update my info" screen — identified the same way vote submission is,
 * via the session cookie (see getSessionGuestId), never a client-supplied
 * id, so a guest can PATCH their own id but no one else's.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  if (!(await isAdminRequest())) {
    const sessionGuestId = await getSessionGuestId();
    if (!sessionGuestId || sessionGuestId !== id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = (await request.json().catch(() => null)) as {
    firstName?: string;
    lastName?: string;
    bracket?: string;
    phone?: string | null;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.firstName !== undefined && !isValidShortText(body.firstName)) {
    return NextResponse.json({ error: "Enter a valid first name." }, { status: 400 });
  }
  if (body.lastName !== undefined && !isValidShortText(body.lastName)) {
    return NextResponse.json({ error: "Enter a valid last name." }, { status: 400 });
  }
  if (body.bracket !== undefined && !isValidBracket(body.bracket)) {
    return NextResponse.json(
      { error: "bracket must be 'adult-male', 'adult-female', 'boy', or 'girl'." },
      { status: 400 },
    );
  }
  const trimmedPhone = body.phone?.trim();
  if (trimmedPhone && !isPlausiblePhone(trimmedPhone)) {
    return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
  }

  try {
    const guest = await getDataStore().updateGuest(id, {
      firstName: body.firstName?.trim(),
      lastName: body.lastName?.trim(),
      bracket: body.bracket as GuestBracket | undefined,
      phone: body.phone !== undefined ? body.phone?.trim() || null : undefined,
    });
    return NextResponse.json({ guest });
  } catch (err) {
    console.error("Failed to update guest:", err);
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }
}

/** Admin-only — also deletes every vote the guest cast or was nominated for, so no orphaned votes remain. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  try {
    await getDataStore().deleteGuest(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete guest:", err);
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }
}
