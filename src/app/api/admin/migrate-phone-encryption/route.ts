import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isAdminRequest } from "@/lib/auth/adminAccess";

/**
 * One-time, admin-triggered migration: encrypts any guest phone numbers
 * still in plaintext from before field-level phone encryption existed (see
 * GoogleSheetsDataStore.migratePlaintextPhones / PRODUCTION_DEPLOY.md).
 * Never runs automatically — an admin clicks the button on /admin/security
 * (or calls this directly) to kick it off. Safe to run more than once:
 * already-encrypted rows are counted and skipped, not touched again.
 */
export async function POST() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await getDataStore().migratePlaintextPhones();
  return NextResponse.json(result);
}
