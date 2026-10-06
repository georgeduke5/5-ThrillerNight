/**
 * Audits field-level phone encryption at rest (see
 * src/lib/data-access/google-sheets/phoneEncryption.ts and
 * GoogleSheetsDataStore's rowToGuest/guestToRow, which are the only two
 * places that call into it). Every test here uses dynamic import() + a
 * fresh module registry per test (vi.resetModules()) so a handful of them
 * can safely swap PHONE_ENCRYPTION_KEY out from under the module to prove
 * the "wrong key" and "missing/malformed key" behavior without affecting
 * any other test in this file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Guest } from "@/lib/data-access";
import type { GuestRow } from "@/lib/data-access/google-sheets/GoogleSheetsDataStore";

const ORIGINAL_KEY = process.env.PHONE_ENCRYPTION_KEY;

beforeEach(() => {
  vi.resetModules();
  process.env.PHONE_ENCRYPTION_KEY = ORIGINAL_KEY;
});

afterEach(() => {
  vi.doUnmock("@/lib/data-access/google-sheets/SheetTable");
  vi.resetModules();
  process.env.PHONE_ENCRYPTION_KEY = ORIGINAL_KEY;
});

function makeGuest(overrides: Partial<Guest>): Guest {
  return {
    id: "guest-1",
    firstName: "Test",
    lastName: "Guest",
    bracket: "adult-male",
    photoRef: null,
    photoUrl: null,
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    groupId: null,
    phone: null,
    checkedInAt: null,
    pendingApprovalAt: null,
    isAdmin: false,
    ...overrides,
  };
}

function makeGuestRow(overrides: Partial<GuestRow>): GuestRow {
  return {
    id: "guest-1",
    firstName: "Test",
    lastName: "Guest",
    bracket: "adult-male",
    photoRef: "",
    photoUrl: "",
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z",
    groupId: "",
    phone: "",
    checkedInAt: "",
    pendingApprovalAt: "",
    isAdmin: "",
    ...overrides,
  };
}

describe("encryptPhone / decryptPhone", () => {
  it("encrypts to a value distinct from the plaintext, and decrypting with the correct key recovers the exact original", async () => {
    const { encryptPhone, decryptPhone } = await import("@/lib/data-access/google-sheets/phoneEncryption");
    const plaintext = "+15555550123";

    const ciphertext = encryptPhone(plaintext);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext).not.toContain("5555550123");
    expect(ciphertext.startsWith("enc:v1:")).toBe(true);

    expect(decryptPhone(ciphertext)).toBe(plaintext);
  });

  it("uses a fresh IV every time — the same plaintext never encrypts to the same ciphertext twice", async () => {
    const { encryptPhone } = await import("@/lib/data-access/google-sheets/phoneEncryption");
    const a = encryptPhone("+15555550123");
    const b = encryptPhone("+15555550123");
    expect(a).not.toBe(b);
  });

  it("fails to decrypt with the wrong key, rather than returning plausible garbage", async () => {
    const { encryptPhone } = await import("@/lib/data-access/google-sheets/phoneEncryption");
    const ciphertext = encryptPhone("+15555550123");

    vi.resetModules();
    process.env.PHONE_ENCRYPTION_KEY = "b".repeat(64); // a different, still well-formed key
    const { decryptPhone: decryptWithWrongKey } = await import("@/lib/data-access/google-sheets/phoneEncryption");

    expect(() => decryptWithWrongKey(ciphertext)).toThrow();
  });

  it("rejects tampered ciphertext (a flipped byte fails the GCM auth tag check)", async () => {
    const { encryptPhone, decryptPhone } = await import("@/lib/data-access/google-sheets/phoneEncryption");
    const ciphertext = encryptPhone("+15555550123");
    const prefix = "enc:v1:";
    const payload = ciphertext.slice(prefix.length);
    const flippedChar = payload[0] === "A" ? "B" : "A";
    const tampered = prefix + flippedChar + payload.slice(1);

    expect(tampered).not.toBe(ciphertext);
    expect(() => decryptPhone(tampered)).toThrow();
  });

  it("rejects malformed/unrecognized values instead of silently producing something", async () => {
    const { decryptPhone } = await import("@/lib/data-access/google-sheets/phoneEncryption");
    expect(() => decryptPhone("not-an-encrypted-value")).toThrow();
    expect(() => decryptPhone("enc:v1:")).toThrow();
    expect(() => decryptPhone("enc:v1:not-valid-base64-for-this-format!!")).toThrow();
  });

  it("never includes the plaintext, the ciphertext, or the key in a thrown error message", async () => {
    const { encryptPhone, decryptPhone } = await import("@/lib/data-access/google-sheets/phoneEncryption");
    const plaintext = "+15555550199";
    const ciphertext = encryptPhone(plaintext);
    const tampered = ciphertext.slice(0, -2) + (ciphertext.endsWith("A") ? "BB" : "AA");

    let thrown: unknown;
    try {
      decryptPhone(tampered);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).not.toContain(plaintext);
    expect(message).not.toContain("5555550199");
    expect(message).not.toContain(tampered);
    expect(message).not.toContain(process.env.PHONE_ENCRYPTION_KEY as string);
  });
});

describe("PHONE_ENCRYPTION_KEY validation (fail loudly at startup)", () => {
  it("throws immediately on import if the key is missing", async () => {
    delete process.env.PHONE_ENCRYPTION_KEY;
    await expect(import("@/lib/data-access/google-sheets/phoneEncryption")).rejects.toThrow(
      /PHONE_ENCRYPTION_KEY/,
    );
  });

  it("throws immediately on import if the key is the wrong length", async () => {
    process.env.PHONE_ENCRYPTION_KEY = "deadbeef"; // valid hex, nowhere near 32 bytes
    await expect(import("@/lib/data-access/google-sheets/phoneEncryption")).rejects.toThrow(
      /PHONE_ENCRYPTION_KEY/,
    );
  });

  it("throws immediately on import if the key isn't valid hex", async () => {
    process.env.PHONE_ENCRYPTION_KEY = "z".repeat(64);
    await expect(import("@/lib/data-access/google-sheets/phoneEncryption")).rejects.toThrow(
      /PHONE_ENCRYPTION_KEY/,
    );
  });
});

describe("GoogleSheetsDataStore's guestToRow / rowToGuest", () => {
  it("a phone number written through the DataStore appears as ciphertext in the raw Sheet row", async () => {
    const { guestToRow } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const row = guestToRow(makeGuest({ phone: "+15555550123" }));

    expect(row.phone).not.toBe("+15555550123");
    expect(row.phone).not.toContain("5555550123");
    expect(row.phone.startsWith("enc:v1:")).toBe(true);
  });

  it("round-trips the exact original phone number back out", async () => {
    const { guestToRow, rowToGuest } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const guest = makeGuest({ phone: "+15555550123" });
    expect(rowToGuest(guestToRow(guest)).phone).toBe("+15555550123");
  });

  it("leaves a null phone as an empty cell, never encrypted", async () => {
    const { guestToRow, rowToGuest } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const row = guestToRow(makeGuest({ phone: null }));
    expect(row.phone).toBe("");
    expect(rowToGuest(row).phone).toBeNull();
  });

  it("still reads a legacy plaintext phone cell correctly (pre-migration backward compatibility)", async () => {
    const { rowToGuest } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const legacyRow = makeGuestRow({ phone: "5555550100" }); // no "enc:v1:" prefix — written before encryption existed
    expect(rowToGuest(legacyRow).phone).toBe("5555550100");
  });
});

describe("DataStore.migratePlaintextPhones", () => {
  it("encrypts only legacy-plaintext rows, leaving already-encrypted and empty ones untouched", async () => {
    const { encryptPhone, decryptPhone } = await import("@/lib/data-access/google-sheets/phoneEncryption");
    const alreadyEncrypted = encryptPhone("+15555550199");

    const rows = [
      { rowNumber: 2, values: makeGuestRow({ id: "g1", phone: "5555550100" }) },
      { rowNumber: 3, values: makeGuestRow({ id: "g2", phone: alreadyEncrypted }) },
      { rowNumber: 4, values: makeGuestRow({ id: "g3", phone: "" }) },
    ];
    const updateRowCalls: Array<{ rowNumber: number; obj: GuestRow }> = [];

    vi.doMock("@/lib/data-access/google-sheets/SheetTable", () => ({
      SheetTable: class FakeSheetTable {
        tabName: string;
        constructor(tabName: string) {
          this.tabName = tabName;
        }
        async getAllRows() {
          return this.tabName === "Guests" ? rows : [];
        }
        async updateRow(rowNumber: number, obj: GuestRow) {
          updateRowCalls.push({ rowNumber, obj });
        }
        async appendRow() {}
        async appendRows() {}
      },
    }));

    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();
    const result = await store.migratePlaintextPhones();

    expect(result).toEqual({ migrated: 1, alreadyEncrypted: 1, skippedEmpty: 1 });
    expect(updateRowCalls).toHaveLength(1);
    expect(updateRowCalls[0]!.rowNumber).toBe(2);

    const migratedPhone = updateRowCalls[0]!.obj.phone;
    expect(migratedPhone.startsWith("enc:v1:")).toBe(true);
    expect(decryptPhone(migratedPhone)).toBe("5555550100");
  });
});
