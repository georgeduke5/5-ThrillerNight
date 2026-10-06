/**
 * GoogleSheetsDataStore.savePasskey — the DataStore write itself enforces
 * one passkey per guest, independent of any route. Kept in its own file:
 * these tests use vi.doMock + vi.resetModules() to swap in a fake
 * SheetTable per test, and resetting the module registry here would also
 * silently reload (and thus de-identify, breaking `instanceof` checks
 * against the original import) modules like @/lib/errors for any other
 * test file sharing a module graph — isolating this file sidesteps that
 * entirely rather than relying on careful ordering.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/data-access/google-sheets/SheetTable");
  vi.resetModules();
});

describe("GoogleSheetsDataStore.savePasskey — the write itself enforces one passkey per guest", () => {
  it("rejects a second passkey for a guest who already has one, without writing it", async () => {
    const existingRow = {
      guestId: "g1",
      credentialId: "cred-old",
      publicKey: "pk",
      counter: "0",
      transports: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    let appendCalled = false;
    vi.doMock("@/lib/data-access/google-sheets/SheetTable", () => ({
      SheetTable: class FakeSheetTable {
        tabName: string;
        constructor(tabName: string) {
          this.tabName = tabName;
        }
        async getAllRows() {
          return this.tabName === "Passkeys" ? [{ rowNumber: 2, values: existingRow }] : [];
        }
        async appendRow() {
          appendCalled = true;
        }
        async appendRows() {}
        async updateRow() {}
      },
    }));

    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();
    await expect(
      store.savePasskey({
        guestId: "g1",
        credentialId: "cred-new",
        publicKey: "pk2",
        counter: 0,
        transports: [],
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    ).rejects.toThrow(/already has a passkey/i);
    expect(appendCalled).toBe(false);
  });

  it("allows a first passkey for a guest with none", async () => {
    let appended: unknown = null;
    vi.doMock("@/lib/data-access/google-sheets/SheetTable", () => ({
      SheetTable: class FakeSheetTable {
        tabName: string;
        constructor(tabName: string) {
          this.tabName = tabName;
        }
        async getAllRows() {
          return [];
        }
        async appendRow(obj: unknown) {
          appended = obj;
        }
        async appendRows() {}
        async updateRow() {}
      },
    }));

    const { GoogleSheetsDataStore } = await import("@/lib/data-access/google-sheets/GoogleSheetsDataStore");
    const store = new GoogleSheetsDataStore();
    await store.savePasskey({
      guestId: "g1",
      credentialId: "cred-new",
      publicKey: "pk",
      counter: 0,
      transports: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(appended).not.toBeNull();
  });
});
