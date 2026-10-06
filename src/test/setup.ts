import { vi } from "vitest";

// Tests that exercise the real voterSession.ts / passkeyChallenge.ts (not a
// mock of them) need SESSION_SECRET set to sign/verify anything. Fall back to
// a fixed test-only value rather than depending on .env.local being present
// (e.g. in CI) — never used for any real signed cookie.
process.env.SESSION_SECRET ??= "test-only-session-secret-do-not-use-in-production-aaaaaaaaaaaa";

// Same reasoning, for phoneEncryption.ts's PHONE_ENCRYPTION_KEY (must be
// exactly 64 hex characters / 32 bytes for AES-256-GCM) — never used to
// encrypt any real phone number.
process.env.PHONE_ENCRYPTION_KEY ??= "a".repeat(64);

// "server-only" is a side-effect-only import that throws when resolved
// through webpack's "browser" bundling condition, to catch a server-only
// module accidentally reaching a client bundle. Under Vitest's plain Node
// environment it resolves to that same throwing stub, which has nothing to
// do with what's actually being tested here — route handlers, and the
// server-only modules they import (adminAccess.ts, voterSession.ts, etc.),
// are SUPPOSED to have this import; it's only a problem for testing it.
vi.mock("server-only", () => ({}));
