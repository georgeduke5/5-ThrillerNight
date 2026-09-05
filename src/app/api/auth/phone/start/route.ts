import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { normalizePhone, sendVerificationCode } from "@/lib/auth/twilioVerify";

function isPlausiblePhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * Stage one of vote-submission phone verification: sends a one-time SMS
 * code via Twilio Verify. No custom rate-limiting here — Twilio Verify has
 * its own built-in abuse protection, and this is a small private event.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { guestId?: string; phone?: string } | null;
  const guestId = body?.guestId;
  const phone = body?.phone?.trim();

  if (!guestId || !phone || !isPlausiblePhone(phone)) {
    return NextResponse.json({ error: "guestId and a valid phone number are required." }, { status: 400 });
  }

  const guest = await getDataStore().getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  try {
    await sendVerificationCode(normalizePhone(phone));
  } catch (err) {
    console.error("Failed to send verification code:", err);
    return NextResponse.json(
      { error: "Failed to send verification code. Please check the number and try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
