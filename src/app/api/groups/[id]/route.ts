import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminSession";

/** Admin-only edit — currently just renaming a group. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const body = (await request.json().catch(() => null)) as { name?: string } | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    const group = await getDataStore().updateGroup(id, { name: body.name });
    return NextResponse.json({ group });
  } catch {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }
}

/** Admin-only — deletes the group outright and clears groupId back to null for every member. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    await getDataStore().deleteGroup(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }
}
