import { describe, expect, it } from "vitest";
import { desanitizeFromSheets, sanitizeForSheets } from "./sanitizeForSheets";

describe("sanitizeForSheets", () => {
  // Common real-world formula/command-injection payloads (CWE-1236) — each
  // must come back prefixed with a single quote so Sheets/Excel treats the
  // cell as plain text instead of evaluating it.
  const injectionPayloads = [
    "=1+1",
    "+cmd|' /C calc'!A0",
    "-2+3+cmd",
    "@SUM(1+1)",
    "=HYPERLINK(\"http://evil.example\",\"click me\")",
    "+1+1",
    "-1+1",
    "@HYPERLINK(\"http://evil.example\")",
  ];

  it.each(injectionPayloads)("prefixes %s with a single quote", (payload) => {
    expect(sanitizeForSheets(payload)).toBe(`'${payload}`);
  });

  it("prefixes a value starting with a tab character", () => {
    const value = "\t=1+1";
    expect(sanitizeForSheets(value)).toBe(`'${value}`);
  });

  it("prefixes a value starting with a carriage return", () => {
    const value = "\r=1+1";
    expect(sanitizeForSheets(value)).toBe(`'${value}`);
  });

  // Ordinary guest-entered text and numbers must never be touched — no
  // false positives on names, phone numbers (that don't start with +),
  // or plain numeric strings.
  const ordinaryValues = [
    "John Smith",
    "O'Brien",
    "Jane Doe-Smith",
    "123",
    "4.5",
    "0",
    "5555550123",
    "adult-male",
    "",
    "The Addams Family",
    "Group of 5",
  ];

  it.each(ordinaryValues)("leaves ordinary value %j unchanged", (value) => {
    expect(sanitizeForSheets(value)).toBe(value);
  });

  it("does not treat a mid-string trigger character as a reason to prefix", () => {
    expect(sanitizeForSheets("Mary-Jane")).toBe("Mary-Jane");
    expect(sanitizeForSheets("user@example.com in bio")).toBe("user@example.com in bio");
  });

  // A real-world case this app specifically has to get right: a phone
  // number stored in E.164 format legitimately starts with "+".
  it("still prefixes a legitimate E.164 phone number (by design — see desanitizeFromSheets)", () => {
    expect(sanitizeForSheets("+15555550123")).toBe("'+15555550123");
  });
});

describe("desanitizeFromSheets", () => {
  it("strips the prefix sanitizeForSheets added, for every injection payload", () => {
    const payloads = ["=1+1", "+cmd|' /C calc'!A0", "-2+3+cmd", "@SUM(1+1)", "+15555550123"];
    for (const payload of payloads) {
      const sanitized = sanitizeForSheets(payload);
      expect(desanitizeFromSheets(sanitized)).toBe(payload);
    }
  });

  it("round-trips a tab- or carriage-return-prefixed value", () => {
    for (const value of ["\t=1+1", "\r=1+1"]) {
      expect(desanitizeFromSheets(sanitizeForSheets(value))).toBe(value);
    }
  });

  it("leaves ordinary values (never sanitized) completely unchanged", () => {
    for (const value of ["John Smith", "123", "", "Group of 5"]) {
      expect(desanitizeFromSheets(value)).toBe(value);
    }
  });

  it("does not strip a literal leading apostrophe that isn't followed by a trigger character", () => {
    // e.g. a name using an ʻokina — sanitizeForSheets would never have
    // touched this in the first place, so desanitizeFromSheets must leave
    // it alone too.
    expect(desanitizeFromSheets("'Alohi")).toBe("'Alohi");
  });

  it("leaves a lone apostrophe alone", () => {
    expect(desanitizeFromSheets("'")).toBe("'");
  });
});
