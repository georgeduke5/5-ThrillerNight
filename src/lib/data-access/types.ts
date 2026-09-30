import type { GuestBracket } from "@/lib/config/types";

export type GuestSource = "manual" | "evite-import" | "walk-in" | "rsvp";

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
   * When this guest first completed phone verification, or null if they
   * never have. Set by DataStore.markGuestCheckedIn, called from
   * POST /api/auth/phone/verify — the same verification endpoint backs both
   * the dedicated "Check In" flow and the per-vote verification prompt, so
   * either one marks a guest checked in; there's no separate flag for which
   * button triggered it, since the resulting state (a verified phone,
   * matching session cookie) is identical either way.
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
   * Admin-controlled kill switch for Twilio SMS verification, defaulting to
   * true. Flipping it off lets identity verification (check-in, the
   * per-vote prompt, "Not you?") still issue a session and mark a guest
   * checked in, just without a real Twilio round-trip — for when Twilio
   * itself is misbehaving. See VerifyIdentityModal.tsx and
   * POST /api/auth/phone/skip-verify.
   */
  phoneVerificationEnabled: boolean;
  /**
   * Admin-controlled switch selecting which identity-verification strategy
   * the registration/login flow uses, defaulting to true for any new
   * VotingStatus record (a fresh deployment, or one that's never had this
   * row written yet) — same "absent means on" pattern as
   * phoneVerificationEnabled/selfServiceWalkinEnabled below. An admin can
   * still flip it off from VotingStatusToggles.tsx, e.g. before the
   * relying-party config (auth.passkey.rpId/origins) is confirmed correct
   * for a new deployment's domain.
   *
   * On: name selection triggers a WebAuthn registration (first time) or
   * authentication (returning guest) ceremony — no SMS at any point.
   * Off: the Twilio SMS flow below runs exactly as before, including the
   * phoneVerificationEnabled kill switch. The two are swappable strategies;
   * neither one's code is removed when the other is active. See
   * VerifyIdentityModal.tsx and /api/auth/passkey/*.
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
}
