import { describe, expect, it } from "vitest";
import { isPlausiblePhone, normalizePhone } from "./phoneFormat";

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

describe("normalizePhone", () => {
  it("assumes a bare 10-digit number is US and adds +1", () => {
    expect(normalizePhone("5555550123")).toBe("+15555550123");
    expect(normalizePhone("(555) 555-0123")).toBe("+15555550123");
  });

  it("passes through a number that already starts with +, stripping formatting", () => {
    expect(normalizePhone("+1 555 555 0123")).toBe("+15555550123");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });
});
