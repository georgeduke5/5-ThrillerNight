import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminSession";
import type { GuestBracket } from "@/lib/config/types";

function isValidBracket(value: unknown): value is GuestBracket {
  return value === "adult-male" || value === "adult-female" || value === "boy" || value === "girl";
}

/** Admin-only edit — name correction or assigning/changing bracket. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const body = (await request.json().catch(() => null)) as {
    firstName?: string;
    lastName?: string;
    bracket?: string;
    phone?: string | null;
  } | null;

  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.bracket !== undefined && !isValidBracket(body.bracket)) {
    return NextResponse.json(
      { error: "bracket must be 'adult-male', 'adult-female', 'boy', or 'girl'." },
      { status: 400 },
    );
  }

  try {
    const guest = await getDataStore().updateGuest(id, {
      firstName: body.firstName?.trim(),
      lastName: body.lastName?.trim(),
      bracket: body.bracket as GuestBracket | undefined,
      phone: body.phone !== undefined ? body.phone?.trim() || null : undefined,
    });
    return NextResponse.json({ guest });
  } catch {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }
}

/** Admin-only — also deletes every vote the guest cast or was nominated for, so no orphaned votes remain. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await getDataStore().deleteGuest(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }
}
