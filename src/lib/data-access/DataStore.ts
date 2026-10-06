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
   * Records that a guest has completed phone verification, if this is the
   * first time — a no-op if they're already marked checked in, so the
   * timestamp reflects their first verification. Called from
   * POST /api/auth/phone/verify regardless of which UI flow (the dedicated
   * check-in button, or the per-vote verification prompt) triggered it.
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
   * Adds guestId to groupId's members and sets guest.groupId. Throws if
   * guestId is already in a group, or if actingGuestId isn't a current
   * member of groupId — except when actingGuestId === guestId, which is
   * always allowed (self-service joining).
   */
  addGuestToGroup(groupId: string, guestId: string, actingGuestId: string): Promise<Group>;
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

  /** Upsert: a new vote from the same voter in the same category overwrites the prior one. */
  recordVote(vote: NewVote): Promise<Vote>;
  getVotes(): Promise<Vote[]>;

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
  /** Admin kill switch for Twilio SMS verification — see VotingStatus.phoneVerificationEnabled. */
  setPhoneVerificationEnabled(enabled: boolean): Promise<void>;
  /** Admin switch choosing passkey vs. SMS verification — see VotingStatus.passkeyAuthEnabled. */
  setPasskeyAuthEnabled(enabled: boolean): Promise<void>;
  /** Admin toggle for self-service walk-in registration — see VotingStatus.selfServiceWalkinEnabled. */
  setSelfServiceWalkinEnabled(enabled: boolean): Promise<void>;

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
