import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";

/**
 * Admin controls for the voting status (requirements Section 5.4): the
 * open/closed toggle and the publish-results action are deliberately
 * separate flags — closing voting doesn't publish results, and publishing
 * doesn't require voting to be closed first (though in practice admins
 * close, review, then publish).
 */
export async function POST(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    isOpen?: boolean;
    resultsPublished?: boolean;
    phoneVerificationEnabled?: boolean;
    passkeyAuthEnabled?: boolean;
    selfServiceWalkinEnabled?: boolean;
    inPersonCheckInEnabled?: boolean;
  } | null;

  const store = getDataStore();
  if (body?.isOpen !== undefined) await store.setVotingOpen(Boolean(body.isOpen));
  if (body?.resultsPublished !== undefined) {
    await store.setResultsPublished(Boolean(body.resultsPublished));
  }
  if (body?.phoneVerificationEnabled !== undefined) {
    await store.setPhoneVerificationEnabled(Boolean(body.phoneVerificationEnabled));
  }
  if (body?.passkeyAuthEnabled !== undefined) {
    await store.setPasskeyAuthEnabled(Boolean(body.passkeyAuthEnabled));
  }
  if (body?.selfServiceWalkinEnabled !== undefined) {
    await store.setSelfServiceWalkinEnabled(Boolean(body.selfServiceWalkinEnabled));
  }
  if (body?.inPersonCheckInEnabled !== undefined) {
    await store.setInPersonCheckInEnabled(Boolean(body.inPersonCheckInEnabled));
  }

  const status = await store.getVotingStatus();
  return NextResponse.json(status);
}
