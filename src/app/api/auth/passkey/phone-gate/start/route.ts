import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { sendVerificationCode } from "@/lib/auth/twilioVerify";
import { normalizePhone } from "@/lib/auth/phoneFormat";
import { isRateLimited, recordHit } from "@/lib/rateLimit";
import { isValidId } from "@/lib/validation";

// Same cap as /api/auth/phone/start, and deliberately the same key
// namespace below — the two flows share one budget per phone number/guest,
// so a caller can't double the allowance by mixing them.
const SMS_START_RATE_LIMIT = { max: 3, windowMs: 10 * 60 * 1000 };

/**
 * Sends the one-time SMS code that gates a guest's very first passkey
 * registration when they have a phone number on file — see
 * Guest.pendingApprovalAt and POST /api/auth/passkey/begin, which returns
 * `{mode: "phone-required"}` to send the client here instead of straight
 * into a registration ceremony.
 *
 * Unlike POST /api/auth/phone/start, the phone number is never accepted
 * from the client — it's looked up server-side from the guest's own
 * record, so there's nothing here for a caller to spoof by supplying
 * someone else's number, and the guest is never even asked to type one in.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string } | null;
  const guestId = body?.guestId;
  if (!isValidId(guestId)) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.passkeyAuthEnabled || !status.phoneVerificationEnabled) {
    return NextResponse.json({ error: "Phone verification is not enabled." }, { status: 403 });
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }
  if (!guest.phone) {
    return NextResponse.json({ error: "No phone number on file for this guest." }, { status: 400 });
  }

  // This gate only ever applies before a guest's very first passkey.
  const existing = await store.getPasskeyByGuestId(guestId);
  if (existing) {
    return NextResponse.json({ error: "This guest already has a passkey registered." }, { status: 409 });
  }

  const normalizedPhone = normalizePhone(guest.phone);
  const phoneKey = `sms-start:phone:${normalizedPhone}`;
  const guestKey = `sms-start:guest:${guestId}`;

  if (isRateLimited(phoneKey, SMS_START_RATE_LIMIT) || isRateLimited(guestKey, SMS_START_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Too many verification code requests. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  try {
    await sendVerificationCode(normalizedPhone);
  } catch (err) {
    console.error("Failed to send phone-gate verification code:", err);
    return NextResponse.json({ error: "Failed to send verification code." }, { status: 502 });
  }

  recordHit(phoneKey, SMS_START_RATE_LIMIT);
  recordHit(guestKey, SMS_START_RATE_LIMIT);

  return NextResponse.json({ ok: true });
}
