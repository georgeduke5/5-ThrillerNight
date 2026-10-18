import { describe, expect, it } from "vitest";
import { isPlausiblePhone, isSmsPhone, toSmsPhone } from "./phoneFormat";

describe("isPlausiblePhone", () => {
  it("accepts realistic, human-typed phone number formats", () => {
    const valid = [
      "5555550123",
      "(555) 555-0123",
      "555-555-0123",
      "555.555.0123",
      "+15555550123",
      "+1 555 555 0123",
      "+44 20 7946 0958",
    ];
    for (const value of valid) {
      expect(isPlausiblePhone(value)).toBe(true);
    }
  });

  it("rejects free text padded with enough digits to pass a digit-count-only check", () => {
    // The old implementation only stripped non-digits and counted what was
    // left, so anything with 7-15 digit characters anywhere in it — no
    // matter what else surrounded them — would have passed.
    const payloads = [
      "<script>alert(1)</script>5555550123",
      "=cmd|' /C calc'!A05555550",
      "abc1234567",
      "5555550123; DROP TABLE guests",
      "'; phone='5555550123",
    ];
    for (const payload of payloads) {
      expect(isPlausiblePhone(payload)).toBe(false);
    }
  });

  it("rejects a real number padded with garbage characters around it (the digits still match on their own)", () => {
    // This is exactly the bypass this check has to close: if validation
    // only looked at the stripped digit count, padding a genuine,
    // already-verified number with arbitrary extra characters would still
    // pass, and normalizePhone (used elsewhere before the Twilio call)
    // would strip the padding back out anyway, letting it slip through.
    expect(isPlausiblePhone("<img src=x>5555550123")).toBe(false);
  });

  it("rejects text with no digits, and text that's too short or too long once digits are counted", () => {
    expect(isPlausiblePhone("not a phone number")).toBe(false);
    expect(isPlausiblePhone("12345")).toBe(false); // only 5 digits
    expect(isPlausiblePhone("1".repeat(16))).toBe(false); // 16 digits, over the cap
  });

  it("rejects empty or whitespace-only input", () => {
    expect(isPlausiblePhone("")).toBe(false);
    expect(isPlausiblePhone("   ")).toBe(false);
  });
});

describe("toSmsPhone", () => {
  it("turns a 10-digit US number, however it's typed, into +1XXXXXXXXXX", () => {
    for (const value of ["5555550123", "(555) 555-0123", "555.555.0123", "1 555 555 0123", "+1 555-555-0123", " +15555550123 "]) {
      expect(toSmsPhone(value)).toBe("+15555550123");
    }
  });

  it("treats placeholders, blanks, malformed and non-US values as no phone", () => {
    const noPhone = [null, undefined, "", "   ", "no phone", "N/A", "none", "555-0123", "55555501234", "25555550123",
      "+5555550123", "+44 20 7946 0958", "555-555-0123 ext 4", "=5555550123", "555+555+0123"];
    for (const value of noPhone) {
      expect(toSmsPhone(value)).toBeNull();
    }
  });
});

describe("isSmsPhone", () => {
  it("accepts only the exact form toSmsPhone returns", () => {
    expect(isSmsPhone("+15555550123")).toBe(true);
    expect(isSmsPhone("5555550123")).toBe(false);
    expect(isSmsPhone("+442079460958")).toBe(false);
    expect(isSmsPhone("no phone")).toBe(false);
  });
});
