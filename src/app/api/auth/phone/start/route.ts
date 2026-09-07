import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { normalizePhone, sendVerificationCode } from "@/lib/auth/twilioVerify";
import { isRateLimited, recordHit } from "@/lib/rateLimit";

function isPlausiblePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

// Belt-and-suspenders on top of Twilio Verify's own account-level abuse
// protection: cap how many sends a given phone number or guestId can
// trigger per window, so neither one can be used to spam a number (or rack
// up Twilio charges against this account) even within Twilio's own limits.
const SMS_START_RATE_LIMIT = { max: 3, windowMs: 10 * 60 * 1000 };

/**
 * Stage one of vote-submission phone verification: sends a one-time SMS
 * code via Twilio Verify.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string; phone?: string } | null;
  const guestId = body?.guestId;
  const phone = body?.phone?.trim();

  if (!guestId || !phone || !isPlausiblePhone(phone)) {
    return NextResponse.json({ error: "guestId and a valid phone number are required." }, { status: 400 });
  }

  const normalizedPhone = normalizePhone(phone);
  const phoneKey = `sms-start:phone:${normalizedPhone}`;
  const guestKey = `sms-start:guest:${guestId}`;

  if (isRateLimited(phoneKey, SMS_START_RATE_LIMIT) || isRateLimited(guestKey, SMS_START_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Too many verification code requests. Please wait a few minutes and try again." },
      { status: 429 },
    );
  }

  const guest = await getDataStore().getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  try {
    await sendVerificationCode(normalizedPhone);
  } catch (err) {
    console.error("Failed to send verification code:", err);
    return NextResponse.json(
      { error: "Failed to send verification code. Please check the number and try again." },
      { status: 502 },
    );
  }

  // Only counted after an actual send succeeds — recording hits on
  // malformed/not-found requests would let someone lock a real phone number
  // or guestId out of legitimate use by deliberately sending bad requests.
  recordHit(phoneKey, SMS_START_RATE_LIMIT);
  recordHit(guestKey, SMS_START_RATE_LIMIT);

  return NextResponse.json({ ok: true });
}
