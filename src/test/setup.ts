import { vi } from "vitest";

// "server-only" is a side-effect-only import that throws when resolved
// through webpack's "browser" bundling condition, to catch a server-only
// module accidentally reaching a client bundle. Under Vitest's plain Node
// environment it resolves to that same throwing stub, which has nothing to
// do with what's actually being tested here — route handlers, and the
// server-only modules they import (adminAccess.ts, voterSession.ts, etc.),
// are SUPPOSED to have this import; it's only a problem for testing it.
vi.mock("server-only", () => ({}));
