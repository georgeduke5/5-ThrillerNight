/**
 * Audits the CSV import feature for SSRF and file-handling risks.
 *
 * Papa.parse is only ever given the uploaded file's own text content, with
 * no `download` option set (the option that would make it treat its input
 * as a URL to fetch) — so nothing in parseCsvToRows/parseCsvForImport can
 * ever make a network request, no matter what a cell or header contains.
 * This file proves that directly: a CSV loaded with URL-like headers and
 * values (a cloud metadata endpoint, a file:// URL, localhost) is parsed as
 * literal text, with a tripwire on global.fetch confirming no outbound
 * request happens. It also covers the abuse limits (file size, row count,
 * column count) and reconfirms both import routes require an admin
 * session (already exhaustively covered in adminAccessControl.test.ts;
 * repeated here minimally since this audit calls for it directly).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCsvToRows } from "@/lib/csv-import/parseCsv";
import { parseCsvForImport } from "@/lib/csv-import/importGuests";
import type { DataStore, Guest, NewGuest } from "@/lib/data-access";

let currentSessionGuestId: string | null = null;
let fakeStore: DataStore;

const ADMIN: Guest = {
  id: "00000000-0000-0000-0000-00000000a1a1",
  firstName: "Ada",
  lastName: "Min",
  bracket: "adult-male",
  photoRef: null,
  photoUrl: null,
  source: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  groupId: null,
  phone: null,
  checkedInAt: "2026-01-01T00:00:00.000Z",
  pendingApprovalAt: null,
  isAdmin: true,
};
const GUEST: Guest = { ...ADMIN, id: "00000000-0000-0000-0000-00000000b1b1", isAdmin: false };

vi.mock("@/lib/auth/voterSession", () => ({
  VOTER_SESSION_COOKIE: "tn_voter_session",
  VOTER_SESSION_MAX_AGE_SECONDS: 43200,
  getSessionGuestId: vi.fn(async () => currentSessionGuestId),
  getVoterSessionPayload: vi.fn(async () => null),
  resolveSessionGuestId: vi.fn(() => null),
  hasSessionFor: vi.fn(() => false),
  createVoterSessionToken: vi.fn(() => "mock-session-token"),
  switchActiveSessionToken: vi.fn(() => "mock-session-token"),
}));

vi.mock("@/lib/data-access", () => ({
  getDataStore: () => fakeStore,
}));

beforeEach(() => {
  currentSessionGuestId = "00000000-0000-0000-0000-00000000a1a1";
  fakeStore = {
    getGuests: vi.fn(async () => [ADMIN, GUEST]),
    getGuestById: vi.fn(async (id: string) => [ADMIN, GUEST].find((g) => g.id === id) ?? null),
    findGuestByName: vi.fn(async () => null),
    addGuest: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    addGuests: vi.fn(async (gs: NewGuest[]) => gs.map((g, i) => ({ ...ADMIN, id: `new-guest-${i}`, ...g }))),
    updateGuest: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    savePhotoReference: vi.fn(async () => {}),
    deleteGuest: vi.fn(async () => {}),
    markGuestCheckedIn: vi.fn(async () => {}),
    markGuestPendingApproval: vi.fn(async () => {}),
    approvePendingGuest: vi.fn(async () => {}),
    rejectPendingGuest: vi.fn(async () => {}),
    resetGuestsToPending: vi.fn(async () => {}),
    removePasskeyAndResetToPending: vi.fn(async () => true),
    requestToJoinGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    resolveGroupJoinRequest: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    migratePlaintextPhones: vi.fn(async () => ({ migrated: 0, alreadyEncrypted: 0, skippedEmpty: 0 })),

    getGroups: vi.fn(async () => []),
    getGroupById: vi.fn(async () => null),
    addGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    addGuestToGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    removeGuestFromGroup: vi.fn(async () => {}),
    updateGroup: vi.fn(async () => {
      throw new Error("not used in this suite");
    }),
    deleteGroup: vi.fn(async () => {}),
    saveGroupPhotoReference: vi.fn(async () => {}),

    recordVote: vi.fn(async (v) => ({ ...v, timestamp: "2026-01-01T00:00:00.000Z" })),
    getVotes: vi.fn(async () => []),

    getPasskeyByGuestId: vi.fn(async () => null),
    getPasskeyByCredentialId: vi.fn(async () => null),
    getPasskeys: vi.fn(async () => []),
    savePasskey: vi.fn(async () => {}),
    updatePasskeyCounter: vi.fn(async () => {}),
    deletePasskey: vi.fn(async () => true),

    getVotingStatus: vi.fn(async () => ({
      isOpen: true,
      resultsPublished: false,
      phoneVerificationEnabled: false,
      passkeyAuthEnabled: true,
      selfServiceWalkinEnabled: true,
      inPersonCheckInEnabled: true,
    })),
    setVotingOpen: vi.fn(async () => {}),
    setResultsPublished: vi.fn(async () => {}),
    setPhoneVerificationEnabled: vi.fn(async () => {}),
    setPasskeyAuthEnabled: vi.fn(async () => {}),
    setSelfServiceWalkinEnabled: vi.fn(async () => {}),
    setInPersonCheckInEnabled: vi.fn(async () => {}),

    recordCandyGuess: vi.fn(async (g) => ({ ...g, timestamp: "2026-01-01T00:00:00.000Z" })),
    getCandyGuesses: vi.fn(async () => []),
    getCandyGuessByGuestId: vi.fn(async () => null),

    getCandyCountStatus: vi.fn(async () => ({ guessingOpen: true, resultsPublished: false, trueCount: null })),
    setCandyGuessingOpen: vi.fn(async () => {}),
    setCandyResultsPublished: vi.fn(async () => {}),
    setCandyTrueCount: vi.fn(async () => {}),

    getCheckInGateToken: vi.fn(async () => null),
    setCheckInGateToken: vi.fn(async () => {}),

    clearVotesAndCandyGuesses: vi.fn(async () => ({ votesCleared: 0, guessesCleared: 0 })),
    deleteNonAdminPasskeys: vi.fn(async () => ({ deleted: 0, guestIds: [] })),
    getSessionsInvalidBefore: vi.fn(async () => null),
    setSessionsInvalidBefore: vi.fn(async () => {}),
    setAllSessionsInvalidBefore: vi.fn(async () => {}),
    getSessionInvalidationThresholds: vi.fn(async () => ({ sessionsInvalidBefore: null, allSessionsInvalidBefore: null })),
    resetToAdminsOnly: vi.fn(async () => ({
      guestsDeleted: 0,
      adminsKept: 0,
      votesCleared: 0,
      guessesCleared: 0,
      passkeysCleared: 0,
      allGuestIds: [],
    })),
  };
});

function csvRequest(fileContent: string, fileName = "guests.csv") {
  const formData = new FormData();
  formData.append("file", new File([fileContent], fileName, { type: "text/csv" }));
  return new Request("http://localhost/api/import", { method: "POST", body: formData }) as never;
}

describe("CSV URL-like content never triggers an outbound request", () => {
  // A tripwire, not a mock to make something work: if anything in the
  // parse/map path ever tried to fetch, this makes the test fail loudly
  // instead of silently succeeding against a real network call.
  function stubFetchTripwire() {
    return vi.spyOn(global, "fetch").mockImplementation(() => {
      throw new Error("fetch should never be called while parsing/mapping a CSV");
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const SSRF_PAYLOADS = [
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "file:///etc/passwd",
    "http://localhost:22/",
    "http://127.0.0.1:6379/",
    "http://[::1]/",
];

  it.each(SSRF_PAYLOADS)("a header cell that looks like a URL (%s) is parsed as literal text, not acted on", async (payload) => {
    const fetchSpy = stubFetchTripwire();
    const csv = `First Name,${payload}\nJohn,yes`;
    const rows = parseCsvToRows(csv);
    expect(rows[0]).toContain(payload);
    expect(rows[1]?.[1]).toBe("yes");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(SSRF_PAYLOADS)("a cell value that looks like a URL (%s) is parsed as literal text, not acted on", async (payload) => {
    const fetchSpy = stubFetchTripwire();
    const csv = `John,Smith,${payload}`;
    const rows = parseCsvToRows(csv);
    expect(rows[0]?.[2]).toBe(payload);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("URL-like names round-trip through parseCsvForImport as inert text", async () => {
    const fetchSpy = stubFetchTripwire();
    const csv =
      "First Name,Last Name,Category,Phone Number\n" +
      "http://169.254.169.254/latest/meta-data/,Smith,Adult Male,555-123-4567\n" +
      "Jane,file:///etc/passwd,Girl,555-123-4568";
    const result = parseCsvForImport(csv);
    expect(result.errors).toEqual([]);
    expect(result.guests[0]?.firstName).toBe("http://169.254.169.254/latest/meta-data/");
    expect(result.guests[1]?.lastName).toBe("file:///etc/passwd");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the same payloads survive a full POST /api/import request with no outbound request", async () => {
    const fetchSpy = stubFetchTripwire();
    const { POST } = await import("@/app/api/import/route");
    const csv = "http://169.254.169.254/latest/meta-data/,Smith,Boy,555-123-4567";
    const res = await POST(csvRequest(csv));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guests[0].firstName).toBe("http://169.254.169.254/latest/meta-data/");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("CSV import abuse limits", () => {
  it("parseCsvToRows rejects a file with more rows than the limit", () => {
    const header = "name,rsvp\n";
    const rows = Array.from({ length: 5001 }, (_, i) => `Guest,${i}`).join("\n");
    expect(() => parseCsvToRows(header + rows)).toThrow(/too many rows/i);
  });

  it("parseCsvToRows accepts a file right at the row limit", () => {
    const header = "name,rsvp\n";
    const rows = Array.from({ length: 5000 }, (_, i) => `Guest,${i}`).join("\n");
    expect(() => parseCsvToRows(header + rows)).not.toThrow();
  });

  it("parseCsvToRows rejects a file with more columns than the limit", () => {
    const columns = Array.from({ length: 51 }, (_, i) => `col${i}`);
    const header = ["First Name", ...columns].join(",") + "\n";
    const row = ["John", ...columns.map(() => "x")].join(",");
    expect(() => parseCsvToRows(header + row)).toThrow(/too many columns/i);
  });

  it("POST /api/import rejects a file over the byte size cap", async () => {
    const { POST } = await import("@/app/api/import/route");
    const oversized = "name,rsvp\n" + "a".repeat(3 * 1024 * 1024); // > 2MB cap, single huge field
    const res = await POST(csvRequest(oversized));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
  });

  it("POST /api/import rejects a file over the row limit with a clear error", async () => {
    const { POST } = await import("@/app/api/import/route");
    const header = "name,rsvp\n";
    const rows = Array.from({ length: 5001 }, (_, i) => `Guest,${i}`).join("\n");
    const res = await POST(csvRequest(header + rows));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too many rows/i);
  });
});

describe("Both import routes require an admin session", () => {
  it("POST /api/import rejects a non-admin session", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b1b1"; // GUEST, not admin
    const { POST } = await import("@/app/api/import/route");
    const res = await POST(csvRequest("name,rsvp\nJohn Smith,yes"));
    expect(res.status).toBe(401);
  });

  it("POST /api/import rejects an unauthenticated request", async () => {
    currentSessionGuestId = null;
    const { POST } = await import("@/app/api/import/route");
    const res = await POST(csvRequest("name,rsvp\nJohn Smith,yes"));
    expect(res.status).toBe(401);
  });

  it("POST /api/import/confirm rejects a non-admin session", async () => {
    currentSessionGuestId = "00000000-0000-0000-0000-00000000b1b1"; // GUEST, not admin
    const { POST } = await import("@/app/api/import/confirm/route");
    const res = await POST(
      new Request("http://localhost/api/import/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ guests: [{ firstName: "John", lastName: "Smith", category: "Adult Male", phone: "555-123-4567" }] }),
      }) as never,
    );
    expect(res.status).toBe(401);
  });
});

describe("POST /api/import/confirm", () => {
  function confirmRequest(guests: unknown[]) {
    return new Request("http://localhost/api/import/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guests }),
    }) as never;
  }

  it("writes each guest's bracket and phone through DataStore.addGuests (where phones are encrypted)", async () => {
    const { POST } = await import("@/app/api/import/confirm/route");
    const res = await POST(
      confirmRequest([
        { firstName: "Ann", lastName: "Lee", category: "Adult Female", phone: "555-111-2222" },
        { firstName: "Cal", lastName: "Lee", category: "Boy", phone: "555-111-2224" },
      ]),
    );
    expect(res.status).toBe(201);
    expect(fakeStore.addGuests).toHaveBeenCalledWith([
      { firstName: "Ann", lastName: "Lee", bracket: "adult-female", phone: "555-111-2222", source: "csv-import" },
      { firstName: "Cal", lastName: "Lee", bracket: "boy", phone: "555-111-2224", source: "csv-import" },
    ]);
  });

  it.each([
    [{ firstName: "Ann", lastName: "Lee", category: "Woman", phone: "555-111-2222" }, /invalid Category/],
    [{ firstName: "Ann", lastName: "Lee", category: "Girl" }, /missing Phone Number/],
    [{ firstName: "Ann", lastName: "Lee", category: "Girl", phone: "=HYPERLINK(1)" }, /invalid Phone Number/],
  ])("rejects an invalid entry without writing anything (%o)", async (guest, message) => {
    const { POST } = await import("@/app/api/import/confirm/route");
    const res = await POST(confirmRequest([guest]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(fakeStore.addGuests).not.toHaveBeenCalled();
  });
});
