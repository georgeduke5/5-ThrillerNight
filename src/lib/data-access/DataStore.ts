import type {
  CandyCountStatus,
  CandyGuess,
  Group,
  GroupUpdate,
  Guest,
  GuestPasskey,
  GuestUpdate,
  NewCandyGuess,
  NewGroup,
  NewGuest,
  NewVote,
  Vote,
  VotingStatus,
} from "./types";

/**
 * The single interface every part of the app uses to read or write guest,
 * group, vote, and photo data. Nothing outside src/lib/data-access may talk
 * to Google Sheets (or any future store) directly — pages, forms, the admin
 * panel, and voting logic all go through a DataStore obtained from
 * getDataStore() (see ./index.ts).
 *
 * To swap backends, write a new class implementing this interface and add
 * one case to the factory in ./index.ts. No other file should need to
 * change.
 */
export interface DataStore {
  getGuests(): Promise<Guest[]>;
  getGuestById(id: string): Promise<Guest | null>;
  /** Case-insensitive exact match on first + last name, used for voter self-identification. */
  findGuestByName(firstName: string, lastName: string): Promise<Guest | null>;

  addGuest(guest: NewGuest): Promise<Guest>;
  /** Bulk insert, used by the CSV importer and manual admin entry. */
  addGuests(guests: NewGuest[]): Promise<Guest[]>;
  updateGuest(id: string, updates: GuestUpdate): Promise<Guest>;
  savePhotoReference(guestId: string, photoRef: string, photoUrl: string): Promise<void>;
  /**
   * Deletes a guest and every vote record touching them — both votes they
   * cast (voterGuestId) and votes cast for them as a nominee (nomineeId) —
   * so no orphaned vote data is left pointing at a guest that no longer
   * exists. Does not touch group membership (Group.memberIds); a deleted
   * guest's id may remain in a group's member list, harmlessly, since every
   * read of group membership goes through the live guest list rather than
   * trusting memberIds directly.
   */
  deleteGuest(id: string): Promise<void>;
  /**
   * Records that a guest has completed verification, if this is the first
   * time — a no-op if they're already marked checked in, so the timestamp
   * reflects their first verification. Called from POST
   * /api/auth/passkey/finish and /api/auth/auto-check-in regardless of
   * which UI flow (the dedicated check-in button, or the per-vote
   * verification prompt) triggered it.
   */
  markGuestCheckedIn(guestId: string): Promise<void>;
  /**
   * Flags a guest as awaiting admin approval instead of checking them in —
   * the outcome of a first-time passkey registration completed with no
   * phone on file (see Guest.pendingApprovalAt). A no-op if the guest is
   * already checked in or already pending, mirroring markGuestCheckedIn's
   * own dedup guard.
   */
  markGuestPendingApproval(guestId: string): Promise<void>;
  /**
   * Admin approval from /admin/check-in: clears the pending flag and checks
   * the guest in, the same terminal state a phone-verified registration
   * would have reached directly.
   */
  approvePendingGuest(guestId: string): Promise<void>;
  /**
   * Puts each listed guest back to pending approval (clears checkedInAt,
   * sets pendingApprovalAt) whatever their current status. Used whenever a
   * guest loses their credential, so they're never left checked in with
   * nothing proving who they are.
   */
  resetGuestsToPending(guestIds: string[]): Promise<void>;
  /**
   * Admin "Remove passkey": resets the guest to pending, then deletes their
   * passkey, as one step. Returns whether a passkey existed.
   */
  removePasskeyAndResetToPending(guestId: string): Promise<boolean>;
  /**
   * Admin rejection from /admin/check-in, for a pending guest whose claimed
   * identity turned out to be wrong: deletes their passkey registration
   * entirely and clears the pending flag, resetting them to a genuine
   * zero-passkey state so the real guest can register from scratch. Leaves
   * checkedInAt untouched (a pending guest is never checked in yet).
   */
  rejectPendingGuest(guestId: string): Promise<void>;
  /**
   * One-time migration for guests whose phone number predates field-level
   * encryption (see GoogleSheetsDataStore's phoneEncryption.ts): encrypts
   * any plaintext phone still on file. Safe to call more than once —
   * already-encrypted and empty phones are reported separately and left
   * untouched. Admin-triggered only (POST /api/admin/migrate-phone-encryption),
   * never run automatically.
   */
  migratePlaintextPhones(): Promise<{ migrated: number; alreadyEncrypted: number; skippedEmpty: number }>;

  getGroups(): Promise<Group[]>;
  getGroupById(id: string): Promise<Group | null>;
  /**
   * Creates a group with creatorGuestId as its sole initial member and sets
   * that guest's groupId. Not atomic — two sequential writes, matching this
   * store's existing no-transaction posture (see recordVote).
   */
  addGroup(newGroup: NewGroup): Promise<Group>;
  /**
   * Directly adds guestId to groupId's members and sets guest.groupId.
   * actingGuestId null means an admin; otherwise it must be a current member
   * of groupId. Throws if guestId is already in a group. Joining on your own
   * is never a direct add — see requestToJoinGroup.
   */
  addGuestToGroup(groupId: string, guestId: string, actingGuestId: string | null): Promise<Group>;
  /**
   * Records guestId's request to join groupId (Group.pendingMemberIds). Not
   * a member until the group's creator approves (resolveGroupJoinRequest).
   * Throws if they're already in a group or have a request open elsewhere.
   */
  requestToJoinGroup(groupId: string, guestId: string): Promise<Group>;
  /**
   * Approves or declines a pending join request. actingGuestId null means an
   * admin; otherwise it must be the group's approver (getGroupApproverId),
   * or the requester themselves withdrawing (approve = false only).
   */
  resolveGroupJoinRequest(
    groupId: string,
    guestId: string,
    actingGuestId: string | null,
    approve: boolean,
  ): Promise<Group>;
  /**
   * Removes guestId from groupId's members and clears that guest's groupId
   * back to null. Throws if the group or guest isn't found; a no-op
   * (doesn't throw) if the guest isn't currently a member of that group.
   * Admin-only at the API layer (DELETE /api/groups/[id]/members/[guestId]);
   * also reused by deleteGuest so a deleted guest is cleaned out of their
   * group's member list too.
   */
  removeGuestFromGroup(groupId: string, guestId: string): Promise<void>;
  updateGroup(id: string, updates: GroupUpdate): Promise<Group>;
  /**
   * Deletes a group and clears groupId back to null for every guest whose
   * groupId currently points at it, so no guest is left referencing a
   * group that no longer exists. Admin-only at the API layer
   * (DELETE /api/groups/[id]).
   */
  deleteGroup(id: string): Promise<void>;
  saveGroupPhotoReference(groupId: string, photoRef: string, photoUrl: string): Promise<void>;

  /**
   * Upsert on (voterGuestId, category): a new vote from the same voter in
   * the same category overwrites the prior one, including under concurrent
   * submissions — see GoogleSheetsDataStore.recordVote for how that's
   * enforced on top of Sheets.
   */
  recordVote(vote: NewVote): Promise<Vote>;
  /**
   * `{ fresh: true }` bypasses the 10s Sheets read cache — use this for
   * POST /api/admin/vote-as/[guestId]'s GET half (an admin checking a
   * guest's current picks before casting a vote on their behalf needs the
   * true current state, not up-to-10s-old data), and the normal
   * cached path everywhere else (GET /api/votes, the results pages),
   * unchanged from before this option existed.
   */
  getVotes(options?: { fresh?: boolean }): Promise<Vote[]>;

  /** That guest's registered passkey, or null if they've never completed a registration ceremony. */
  getPasskeyByGuestId(guestId: string): Promise<GuestPasskey | null>;
  /**
   * Looks a passkey up by its credential id rather than its owner — used to
   * reject an assertion signed by a credential registered to a *different*
   * guest than the one being claimed, which the guestId-keyed lookup alone
   * can't catch.
   */
  getPasskeyByCredentialId(credentialId: string): Promise<GuestPasskey | null>;
  /** Every stored passkey — used by the admin Guests page to show a "Has passkey" indicator per guest. */
  getPasskeys(): Promise<GuestPasskey[]>;
  /**
   * Stores a guest's passkey. One passkey per guest, enforced here (not
   * just at the route layer) as the final guard: throws if this guest
   * already has one on file, rather than silently overwriting it — the
   * only way to clear an existing one is deletePasskey, the admin-only
   * "Remove Passkey" action.
   */
  savePasskey(passkey: GuestPasskey): Promise<void>;
  /**
   * Persists the authenticator's post-assertion signature counter. Called
   * after every successful authentication so a replayed (stale-counter)
   * assertion can be detected on the next one.
   */
  updatePasskeyCounter(guestId: string, counter: number): Promise<void>;
  /**
   * Admin-only: clears whatever passkey this guest has on file (a no-op,
   * returning false, if they have none), re-opening registration for them.
   * See DELETE /api/guests/[id]/passkey, which also revokes any session
   * this guest currently holds.
   */
  deletePasskey(guestId: string): Promise<boolean>;

  getVotingStatus(): Promise<VotingStatus>;
  setVotingOpen(isOpen: boolean): Promise<void>;
  setResultsPublished(published: boolean): Promise<void>;
  /** Admin toggle for the on-file-phone SMS gate before a first passkey registration — see VotingStatus.phoneVerificationEnabled. */
  setPhoneVerificationEnabled(enabled: boolean): Promise<void>;
  /** Admin kill switch for the passkey ceremony — see VotingStatus.passkeyAuthEnabled. */
  setPasskeyAuthEnabled(enabled: boolean): Promise<void>;
  /** Admin toggle for self-service walk-in registration — see VotingStatus.selfServiceWalkinEnabled. */
  setSelfServiceWalkinEnabled(enabled: boolean): Promise<void>;
  /** Admin toggle for in-person manual approval — see VotingStatus.inPersonCheckInEnabled. */
  setInPersonCheckInEnabled(enabled: boolean): Promise<void>;

  /**
   * The current party-presence token, or null if an admin has never
   * generated one — see /admin/security's "Generate New Code" and
   * POST /api/auth/checkin-gate/claim. There is at most one valid token at
   * a time: generating a new one immediately supersedes whatever was there
   * before, with no separate expiry of its own (the admin controls its
   * lifecycle manually, by generating a fresh one).
   */
  getCheckInGateToken(): Promise<string | null>;
  /** Admin-only — see POST /api/admin/checkin-gate/generate. Overwrites (invalidates) any previously generated token. */
  setCheckInGateToken(token: string): Promise<void>;

  /**
   * Admin-only "Remove all voting and guessing data" (/admin/security's
   * Danger Zone): blanks every row in both Votes and CandyGuesses. Never
   * touches Guests, Groups, Settings, or Passkeys. See
   * POST /api/admin/reset-voting-data.
   */
  clearVotesAndCandyGuesses(): Promise<{ votesCleared: number; guessesCleared: number }>;

  /**
   * Admin-only "Remove all login sessions and passkey data" (/admin/
   * security's Danger Zone): blanks every Passkeys row belonging to a
   * non-admin guest (Guest.isAdmin false), leaving admin guests' passkeys
   * untouched, and in the same step resets every affected guest to
   * pending approval (see resetGuestsToPending) so no one is left checked
   * in without a credential. Returns the affected guest ids so the caller can also
   * revoke their in-memory sessions immediately (see
   * sessionRevocation.ts) alongside the persistent
   * setSessionsInvalidBefore call below. See POST /api/admin/reset-sessions.
   */
  deleteNonAdminPasskeys(): Promise<{ deleted: number; guestIds: string[] }>;

  /**
   * The persistent counterpart to sessionRevocation.ts's in-memory,
   * per-instance epoch counter: a guest's signed session cookie is invalid
   * if it was minted (VoterSessionEntry.iat) before this timestamp, UNLESS
   * that guest is an admin — see voterSession.ts and src/proxy.ts, every
   * place a session is resolved. Needed because the in-memory mechanism
   * alone isn't enough for a party-wide "sign everyone out" action: it
   * resets on every cold start and isn't shared across concurrent
   * serverless instances. Null means no mass reset has ever been
   * triggered. Always read fresh (never the 10s read cache) — this value
   * only ever changes right when an admin deliberately triggers a reset,
   * and that must take effect immediately, not up to 10 seconds later.
   */
  getSessionsInvalidBefore(): Promise<number | null>;
  /** Admin-only — see POST /api/admin/reset-sessions. */
  setSessionsInvalidBefore(timestamp: number): Promise<void>;

  /**
   * Like sessionsInvalidBefore above, but with NO admin exemption: a
   * guest's session — including an admin's own — is invalid if minted
   * before this timestamp, full stop. A separate Settings value (not the
   * same key), so "Remove all login sessions and passkey data" (admin-
   * exempt) keeps working exactly as before even after "Reset to admins
   * only" (this one) has also run. Set by POST /api/admin/reset-to-admins-only,
   * the one action that must also sign out the admin performing it. Null
   * means this particular reset has never been triggered. Read together
   * with sessionsInvalidBefore via getSessionInvalidationThresholds below
   * so every session-resolution path (voterSession.ts, proxy.ts) checks
   * both at the cost of one fresh Settings read, not two.
   */
  setAllSessionsInvalidBefore(timestamp: number): Promise<void>;
  /**
   * Both session-invalidation thresholds (sessionsInvalidBefore,
   * admin-exempt, and allSessionsInvalidBefore, no exemption) in a single
   * fresh Settings read — see the doc comments on each above. Used by
   * voterSession.ts and proxy.ts, every place a session is resolved.
   */
  getSessionInvalidationThresholds(): Promise<{
    sessionsInvalidBefore: number | null;
    allSessionsInvalidBefore: number | null;
  }>;

  /**
   * Admin-only "Reset to admins only" (/admin/security's Danger Zone): the
   * full pre-party reset. Deletes every Guests row except the ones
   * currently flagged isAdmin true — those are left completely untouched,
   * not re-written in any way. Blanks every row in Votes, CandyGuesses, and
   * Passkeys outright, with no exception for admins (an admin's own votes,
   * guesses, and passkey are wiped exactly like everyone else's) — since
   * nothing is left in those three sheets at all afterward, there is
   * nothing left to orphan. Groups and every existing Settings value
   * (including the check-in gate token) are untouched; this never calls
   * setSessionsInvalidBefore or setCheckInGateToken itself. Session
   * invalidation (setAllSessionsInvalidBefore) is the caller's job, not
   * this method's — a completely orthogonal, Settings-backed mechanism.
   * Returns every guest id that existed before the reset (both the ones
   * kept and the ones deleted) so the caller can also revoke their
   * in-memory sessions immediately (see sessionRevocation.ts). See POST
   * /api/admin/reset-to-admins-only.
   */
  resetToAdminsOnly(): Promise<{
    guestsDeleted: number;
    adminsKept: number;
    votesCleared: number;
    guessesCleared: number;
    passkeysCleared: number;
    allGuestIds: string[];
  }>;

  /** Upsert: a new guess from the same guest overwrites their prior one — same pattern as recordVote. */
  recordCandyGuess(guess: NewCandyGuess): Promise<CandyGuess>;
  getCandyGuesses(): Promise<CandyGuess[]>;
  /** That guest's own current guess, or null if they haven't guessed yet — used to pre-fill the form on return visits. */
  getCandyGuessByGuestId(guestId: string): Promise<CandyGuess | null>;

  getCandyCountStatus(): Promise<CandyCountStatus>;
  setCandyGuessingOpen(open: boolean): Promise<void>;
  setCandyResultsPublished(published: boolean): Promise<void>;
  /** Pass null to clear a previously-entered count (e.g. admin correcting a typo before publishing). */
  setCandyTrueCount(count: number | null): Promise<void>;
}
