import { NextRequest, NextResponse } from "next/server";
import { getDataStore } from "@/lib/data-access";
import { isPlausiblePhone } from "@/lib/auth/phoneFormat";
import { isValidShortText } from "@/lib/validation";
import { isCheckInGateOpenForRequest } from "@/lib/auth/checkInGate";
import { getClientIp, isRateLimited, recordHit } from "@/lib/rateLimit";
import { resetInProgressResponse } from "@/lib/resetInProgressResponse";
import type { GuestBracket } from "@/lib/config/types";

// Generous for a family arriving together on one phone, far too low to
// bulk-load the guest list.
const WALKIN_RATE_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };

function isValidBracket(value: unknown): value is GuestBracket {
  return value === "adult-male" || value === "adult-female" || value === "boy" || value === "girl";
}

/**
 * Public endpoint behind the "walk-in guest" QR code (requirements Section
 * 5.2): lets an unlisted guest add themselves to the guest/nominee list on
 * the spot with a minimal name + bracket entry, standing in for a full
 * RSVP this year. "Couple/Group" is deliberately not a valid bracket here —
 * guests only ever self-register into one of the four individual brackets.
 *
 * Unauthenticated by nature, so it's held to the same bar as every other
 * guestId-free check-in route, all enforced here rather than by the page:
 * the admin's Self-Service Walk-In toggle, tonight's party-presence QR code
 * (see checkInGate.ts), and a per-IP rate limit so it can't be scripted to
 * flood the guest/nominee list.
 */
export async function POST(request: NextRequest) {
  const status = await getDataStore().getVotingStatus();
  if (!status.selfServiceWalkinEnabled) {
    return NextResponse.json({ error: "Walk-in registration is turned off." }, { status: 403 });
  }
  if (!(await isCheckInGateOpenForRequest())) {
    return NextResponse.json({ error: "Adding yourself requires tonight's QR code." }, { status: 403 });
  }
  const ipKey = `walkin:${getClientIp(request)}`;
  if (isRateLimited(ipKey, WALKIN_RATE_LIMIT)) {
    return NextResponse.json(
      { error: "Too many guests added from this device. Please find George or Sarah." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    firstName?: string;
    lastName?: string;
    bracket?: string;
    phone?: string;
  } | null;

  const bracket = body?.bracket;
  const phone = body?.phone?.trim() || null;

  if (!isValidShortText(body?.firstName) || !isValidShortText(body?.lastName) || !isValidBracket(bracket)) {
    return NextResponse.json(
      {
        error:
          "firstName, lastName, and a valid bracket ('adult-male' | 'adult-female' | 'boy' | 'girl') are required.",
      },
      { status: 400 },
    );
  }
  const firstName = body.firstName.trim();
  const lastName = body.lastName.trim();
  if (phone && !isPlausiblePhone(phone)) {
    return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
  }

  recordHit(ipKey, WALKIN_RATE_LIMIT);
  let guest;
  try {
    guest = await getDataStore().addGuest({
      firstName,
      lastName,
      bracket,
      source: "walk-in",
      phone,
    });
  } catch (err) {
    const res = resetInProgressResponse(err);
    if (res) return res;
    throw err;
  }

  return NextResponse.json({ guest }, { status: 201 });
}
