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
    })),
    setVotingOpen: vi.fn(async () => {}),
    setResultsPublished: vi.fn(async () => {}),
    setPhoneVerificationEnabled: vi.fn(async () => {}),
    setPasskeyAuthEnabled: vi.fn(async () => {}),
    setSelfServiceWalkinEnabled: vi.fn(async () => {}),

    recordCandyGuess: vi.fn(async (g) => ({ ...g, timestamp: "2026-01-01T00:00:00.000Z" })),
    getCandyGuesses: vi.fn(async () => []),
    getCandyGuessByGuestId: vi.fn(async () => null),

    getCandyCountStatus: vi.fn(async () => ({ guessingOpen: true, resultsPublished: false, trueCount: null })),
    setCandyGuessingOpen: vi.fn(async () => {}),
    setCandyResultsPublished: vi.fn(async () => {}),
    setCandyTrueCount: vi.fn(async () => {}),
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

  it.each(SSRF_PAYLOADS)("a header named after a URL-like target (%s) is parsed as a literal header, not acted on", async (payload) => {
    const fetchSpy = stubFetchTripwire();
    const csv = `name,${payload}\nJohn Smith,yes`;
    const { headers, rows } = parseCsvToRows(csv);
    expect(headers).toContain(payload);
    expect(rows[0]?.[payload]).toBe("yes");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each(SSRF_PAYLOADS)("a cell value that looks like a URL (%s) is parsed as literal text, not acted on", async (payload) => {
    const fetchSpy = stubFetchTripwire();
    const csv = `name,rsvp,notes\nJohn Smith,yes,${payload}`;
    const { rows } = parseCsvToRows(csv);
    expect(rows[0]?.notes).toBe(payload);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a full malicious-looking CSV round-trips through parseCsvForImport as inert candidate data", async () => {
    const fetchSpy = stubFetchTripwire();
    const csv =
      "name,rsvp,website\n" +
      "John Smith,yes,http://169.254.169.254/latest/meta-data/\n" +
      "Jane Doe,yes,file:///etc/passwd";
    const result = parseCsvForImport(csv);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]?.raw.website).toBe("http://169.254.169.254/latest/meta-data/");
    expect(result.candidates[1]?.raw.website).toBe("file:///etc/passwd");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the same payloads survive a full POST /api/import request with no outbound request", async () => {
    const fetchSpy = stubFetchTripwire();
    const { POST } = await import("@/app/api/import/route");
    const csv = "name,rsvp,website\nJohn Smith,yes,http://169.254.169.254/latest/meta-data/";
    const res = await POST(csvRequest(csv));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates[0].raw.website).toBe("http://169.254.169.254/latest/meta-data/");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("CSV import abuse limits", () => {
  it("parseCsvToRows rejects a file with more rows than the limit", () => {
    const header = "name,rsvp\n";
    const rows = Array.from({ length: 5001 }, (_, i) => `Guest ${i},yes`).join("\n");
    expect(() => parseCsvToRows(header + rows)).toThrow(/too many rows/i);
  });

  it("parseCsvToRows accepts a file right at the row limit", () => {
    const header = "name,rsvp\n";
    const rows = Array.from({ length: 5000 }, (_, i) => `Guest ${i},yes`).join("\n");
    expect(() => parseCsvToRows(header + rows)).not.toThrow();
  });

  it("parseCsvToRows rejects a file with more columns than the limit", () => {
    const columns = Array.from({ length: 51 }, (_, i) => `col${i}`);
    const header = ["name", ...columns].join(",") + "\n";
    const row = ["John Smith", ...columns.map(() => "x")].join(",");
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
    const rows = Array.from({ length: 5001 }, (_, i) => `Guest ${i},yes`).join("\n");
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
        body: JSON.stringify({ guests: [{ firstName: "John", lastName: "Smith", bracket: "adult-male" }] }),
      }) as never,
    );
    expect(res.status).toBe(401);
  });
});
