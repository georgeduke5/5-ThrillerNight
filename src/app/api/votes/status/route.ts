import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isCheckInGateOpenForRequest } from "@/lib/auth/checkInGate";

export const dynamic = "force-dynamic";

export async function GET() {
  const [status, checkInGateOpen] = await Promise.all([
    getDataStore().getVotingStatus(),
    isCheckInGateOpenForRequest(),
  ]);
  return NextResponse.json({ ...status, checkInGateOpen });
}
