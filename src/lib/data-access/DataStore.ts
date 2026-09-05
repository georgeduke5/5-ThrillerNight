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
  updateGroup(id: string, updates: GroupUpdate): Promise<Group>;
  saveGroupPhotoReference(groupId: string, photoRef: string, photoUrl: string): Promise<void>;

  /** Upsert: a new vote from the same voter in the same category overwrites the prior one. */
  recordVote(vote: NewVote): Promise<Vote>;
  getVotes(): Promise<Vote[]>;

  getVotingStatus(): Promise<VotingStatus>;
  setVotingOpen(isOpen: boolean): Promise<void>;
  setResultsPublished(published: boolean): Promise<void>;
}
