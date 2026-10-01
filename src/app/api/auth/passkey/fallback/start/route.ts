import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isPlausiblePhone, normalizePhone, sendVerificationCode } from "@/lib/auth/twilioVerify";
import { isRateLimited, recordHit } from "@/lib/rateLimit";

// Same cap and key namespace as the pre-registration phone gate
// (.../phone-gate/start) — from the guest's perspective this is the same
// "prove your phone" action, just triggered after a failed ceremony instead
// of before one, so it shares that budget rather than doubling it.
const SMS_START_RATE_LIMIT = { max: 3, windowMs: 10 * 60 * 1000 };

/**
 * Stage one of the post-passkey-failure phone fallback — the replacement
 * for the old no-verification "sign in anyway": a guest whose passkey
 * ceremony failed, errored, or was declined can prove their identity by SMS
 * instead. See VerifyIdentityModal's "Verify a different way" link, offered
 * after any failed ceremony (registration or authentication alike).
 *
 * Called first as a `probe` (no phone, `probe: true`) to find out whether a
 * phone is already on file — never revealed to the client (see Guest.phone)
 * — without sending anything yet: `needsPhone` is the answer to "should I
 * show a phone field," and when it's false the client shows a "Send code"
 * confirmation instead of texting the guest immediately on arrival (see
 * VerifyIdentityModal's "fallback" step). The actual send only happens on a
 * non-probe call — either with no phone (guest already has one on file) or
 * with one the guest just typed in. A newly-entered number is never saved
 * here, only once the code is actually verified (see .../fallback/verify),
 * so a wrong guess or an abandoned attempt never pollutes a guest's record.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    guestId?: string;
    phone?: string;
    probe?: boolean;
  } | null;
  const guestId = body?.guestId;
  if (!guestId) {
    return NextResponse.json({ error: "guestId is required." }, { status: 400 });
  }

  const store = getDataStore();
  const status = await store.getVotingStatus();
  if (!status.passkeyAuthEnabled) {
    return NextResponse.json({ error: "Passkey login is not enabled." }, { status: 403 });
  }
  if (!status.phoneVerificationEnabled) {
    return NextResponse.json({ error: "Phone verification is not enabled." }, { status: 403 });
  }

  const guest = await store.getGuestById(guestId);
  if (!guest) {
    return NextResponse.json({ error: "Guest not found." }, { status: 404 });
  }

  let phoneToUse = guest.phone;
  if (!phoneToUse) {
    const typed = body?.phone?.trim();
    if (!typed) {
      return NextResponse.json({ ok: false, needsPhone: true });
    }
    if (!isPlausiblePhone(typed)) {
      return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
    }
    // Deliberately no uniqueness check against other guests' phones — the
    // same number is expected to cover multiple guests sharing one phone
    // (e.g. a family), same as the pre-existing phone-gate and legacy SMS
    // paths never restrict that either.
    phoneToUse = typed;
  }

  if (body?.probe) {
    // Just answering "is a phone available" — no send, no rate-limit hit.
    return NextResponse.json({ ok: true, needsPhone: false });
  }

  const normalizedPhone = normalizePhone(phoneToUse);
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
    console.error("Failed to send fallback verification code:", err);
    return NextResponse.json({ error: "Failed to send verification code." }, { status: 502 });
  }

  recordHit(phoneKey, SMS_START_RATE_LIMIT);
  recordHit(guestKey, SMS_START_RATE_LIMIT);

  return NextResponse.json({ ok: true });
}
