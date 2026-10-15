import type { GuestBracket } from "@/lib/config/types";

/** "evite-import" is no longer written (the Evite importer was replaced by the CSV format in csv-import/importGuests.ts) but still appears on guest rows imported before then. */
export type GuestSource = "manual" | "csv-import" | "evite-import" | "walk-in" | "rsvp";

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
  /**
   * Admin-entered contact number, e.g. for reaching a guest directly.
   * Unrelated to (and never populated by) Twilio Verify's phone-verification
   * flow, which remains deliberately stateless and never persists the phone
   * number used to verify (see src/lib/auth/voterSession.ts / README.md).
   */
  phone: string | null;
  /** Storage-specific reference to the uploaded photo (e.g. a Drive file id). */
  photoRef: string | null;
  /** Directly usable URL for rendering the photo, if one has been uploaded. */
  photoUrl: string | null;
  source: GuestSource;
  createdAt: string;
  /** Id of the Group this guest belongs to, or null. A guest belongs to at most one group. */
  groupId: string | null;
  /**
   * When this guest first completed verification, or null if they never
   * have. Set by DataStore.markGuestCheckedIn, called from both the
   * dedicated "Check In" flow and the per-vote verification prompt — they
   * share one verification flow (VerifyIdentityModal.tsx), so there's no
   * separate flag for which button triggered it, since the resulting state
   * (a verified identity, matching session cookie) is identical either way.
   */
  checkedInAt: string | null;
  /**
   * Set instead of checkedInAt when a guest completes their very first
   * passkey registration with no phone on file to verify against (see
   * POST /api/auth/passkey/finish) — they get full normal site access, but
   * are held out of "checked in" until an admin reviews them on
   * /admin/check-in, since name selection alone doesn't otherwise bind the
   * physical person to that identity. Null once never flagged, or once an
   * admin has approved or rejected them (see DataStore.approvePendingGuest /
   * rejectPendingGuest).
   */
  pendingApprovalAt: string | null;
  /**
   * Grants admin-portal access when true — the ONLY admin authentication
   * mechanism in this app (see src/lib/auth/adminAccess.ts): whoever is the
   * active guest in the current voter session, checked live against this
   * field on every admin-gated request. Deliberately not editable from any
   * admin UI (no toggle in the guest-edit screen) — this is a Sheet-only
   * knob George sets directly in the Guests tab, so a compromised admin
   * session can never grant itself or anyone else admin access. Never
   * exposed to a non-admin caller: GET /api/guests's public shape is built
   * from an explicit field allowlist (toPublicGuest), not a blacklist, so
   * this is excluded by construction rather than by remembering to strip it.
   */
  isAdmin: boolean;
}

export interface NewGuest {
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
  source: GuestSource;
  /** Optional — a guest can be added without a contact number on file. */
  phone?: string | null;
}

export interface GuestUpdate {
  firstName?: string;
  lastName?: string;
  bracket?: GuestBracket;
  phone?: string | null;
}

/**
 * A Couple/Group costume entry — a separate record from Guest, nominated as
 * a single unit in the Couple/Group voting category rather than by its
 * individual members. A guest can belong to at most one group (see
 * Guest.groupId); membership is only ever changed via DataStore.addGroup /
 * addGuestToGroup, never through the generic guest-edit surface.
 */
export interface Group {
  id: string;
  name: string;
  photoRef: string | null;
  photoUrl: string | null;
  memberIds: string[];
  createdAt: string;
  /**
   * Who created the group — the one guest who approves join requests (see
   * pendingMemberIds). Null for a group created before this was recorded,
   * or whose creator has since left; getGroupApproverId falls back to the
   * first current member in that case. Optional only so older fixtures
   * still type-check; the data store always fills it.
   */
  creatorGuestId?: string | null;
  /** Guests who asked to join and are waiting on the creator's approval — not members yet (no voting as the group, no photo changes). */
  pendingMemberIds?: string[];
}

export interface NewGroup {
  name: string;
  /** Becomes the group's sole initial member. */
  creatorGuestId: string;
}

export interface GroupUpdate {
  name?: string;
}

/**
 * A guest's single registered WebAuthn passkey credential.
 *
 * Deliberately a separate record from Guest rather than extra Guest fields:
 * the guest list is public (GET /api/guests serves it to every voting
 * browser), and credential ids don't belong in that payload. Nothing here
 * is ever sent to a client — the passkey endpoints read it server-side and
 * return only ceremony options.
 *
 * One credential per guest, keyed by guestId: each individual guest record
 * gets its own registration ceremony, including a parent registering
 * separately for each of their children on the same device. Re-registering
 * for a guest who already has one replaces it (see DataStore.savePasskey).
 */
export interface GuestPasskey {
  guestId: string;
  /** Base64URL credential id, as returned by the authenticator. */
  credentialId: string;
  /** Base64URL-encoded COSE public key bytes. */
  publicKey: string;
  /** Authenticator signature counter, updated after each successful assertion for replay detection. */
  counter: number;
  /** Transports the authenticator reported (e.g. "internal", "hybrid"), used to hint the browser UI. */
  transports: string[];
  createdAt: string;
}

export interface Vote {
  voterGuestId: string;
  category: string;
  /** A Guest id or a Group id, depending on the category's nomineeType. */
  nomineeId: string;
  timestamp: string;
}

export interface NewVote {
  voterGuestId: string;
  category: string;
  nomineeId: string;
}

/**
 * One guest's candy-jar guess. Separate from Vote (not a Vote with a
 * special category) since it's a different shape entirely — a number, not
 * a nominee pick — and lives in its own "CandyGuesses" sheet tab.
 *
 * `guestName` is denormalized (also derivable by joining `guestId` against
 * the live guest list) so the raw sheet is readable at a glance without a
 * lookup; display/results code still joins against the live guest list by
 * id where it matters (e.g. a guest's name changing after they guessed).
 */
export interface CandyGuess {
  guestId: string;
  guestName: string;
  guess: number;
  timestamp: string;
}

export interface NewCandyGuess {
  guestId: string;
  guestName: string;
  guess: number;
}

/**
 * Sheets-backed admin state for the Candy Count contest — the same
 * "Settings" key-value pattern VotingStatus uses, kept as a separate type
 * (not folded into VotingStatus) since this is a deliberately separate
 * feature with its own separate admin page, not a costume-voting control.
 */
export interface CandyCountStatus {
  /** Admin-controlled "Guessing Open"/"Guessing Closed" toggle, defaulting to closed (same false-default as VotingStatus.isOpen) until an admin opens it. */
  guessingOpen: boolean;
  /** Same private-then-publish pattern as VotingStatus.resultsPublished — the admin can always compute/view the closest guess privately once trueCount is set; guests only see it once this is true. */
  resultsPublished: boolean;
  /** The admin-entered actual candy count, or null until they've entered it. Guessing can be closed before this is known. */
  trueCount: number | null;
}

export interface VotingStatus {
  isOpen: boolean;
  resultsPublished: boolean;
  /**
   * Whether a guest's very first passkey registration must be gated behind
   * an SMS code sent to their on-file phone number, defaulting to true. Off
   * means off, not "soft" — POST /api/auth/passkey/phone-gate/start and
   * /verify reject every request regardless of what any client shows, and
   * POST /api/auth/passkey/begin skips straight to a registration ceremony
   * for a guest with a phone on file, same as it already does for a guest
   * with none (see Guest.pendingApprovalAt).
   */
  phoneVerificationEnabled: boolean;
  /**
   * Admin-controlled kill switch for the passkey ceremony itself —
   * registration and authentication alike — defaulting to true for any new
   * VotingStatus record (a fresh deployment, or one that's never had this
   * row written yet). Since passkey (gated by phoneVerificationEnabled on a
   * guest's first registration) is the only automated way to check in, an
   * admin can still flip this off, e.g. before the relying-party config
   * (auth.passkey.rpId/origins) is confirmed correct for a new deployment's
   * domain — guests are then told to find an admin for in-person approval
   * instead. See VerifyIdentityModal.tsx and /api/auth/passkey/*.
   */
  passkeyAuthEnabled: boolean;
  /**
   * Admin-controlled toggle for self-service walk-in registration,
   * defaulting to true. Flipping it off makes /vote/walkin behave as
   * not-found (consistent with this app's other disabled-feature routes)
   * and hides VerifyIdentityModal's "Didn't RSVP? Add yourself here" link —
   * for closing off new registrations once the guest list is final.
   */
  selfServiceWalkinEnabled: boolean;
  /**
   * Whether a guest who can't complete the automated passkey flow can be
   * manually checked in by an admin in person, defaulting to true. Off
   * makes POST /api/auth/passkey/fallback/give-up reject every request — so
   * the pending-approval/locked-waiting-screen state it leads to
   * (Guest.pendingApprovalAt, /check-in/pending) is never reachable this way
   * while it's off, and VerifyIdentityModal's failure screen stops offering
   * it. Independent of passkeyAuthEnabled, even though its implementation
   * happens to live under the passkey/fallback path for historical reasons.
   */
  inPersonCheckInEnabled: boolean;
}
