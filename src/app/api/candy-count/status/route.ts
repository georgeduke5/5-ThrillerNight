import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";

export const dynamic = "force-dynamic";

/** Mirrors GET /api/votes/status — deliberately ungated by candyCountModuleEnabled, same as its voting counterpart. */
export async function GET() {
  const status = await getDataStore().getCandyCountStatus();
  return NextResponse.json(status);
}
