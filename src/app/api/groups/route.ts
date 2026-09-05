import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";

// Group list changes constantly (guests creating/joining groups) — never cache statically.
export const dynamic = "force-dynamic";

export async function GET() {
  const groups = await getDataStore().getGroups();
  return NextResponse.json({ groups });
}

/**
 * Public — any identified guest can create a group for themselves
 * (self-service, requirements: "give them the option to create a new
 * group or join an existing one").
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    creatorGuestId?: string;
  } | null;

  const name = body?.name?.trim();
  const creatorGuestId = body?.creatorGuestId;

  if (!name || !creatorGuestId) {
    return NextResponse.json({ error: "name and creatorGuestId are required." }, { status: 400 });
  }

  try {
    const group = await getDataStore().addGroup({ name, creatorGuestId });
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create group." },
      { status: 400 },
    );
  }
}
