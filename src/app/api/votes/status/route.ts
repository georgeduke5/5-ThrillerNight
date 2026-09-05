import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getDataStore().getVotingStatus();
  return NextResponse.json(status);
}
