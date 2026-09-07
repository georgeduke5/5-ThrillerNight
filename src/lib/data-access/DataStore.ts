import type {
  Group,
  GroupUpdate,
  Guest,
  GuestUpdate,
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

  getVotingStatus(): Promise<VotingStatus>;
  setVotingOpen(isOpen: boolean): Promise<void>;
  setResultsPublished(published: boolean): Promise<void>;
}
