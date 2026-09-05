import type { GuestBracket } from "@/lib/config/types";

export type GuestSource = "manual" | "evite-import" | "walk-in" | "rsvp";

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
  /** Storage-specific reference to the uploaded photo (e.g. a Drive file id). */
  photoRef: string | null;
  /** Directly usable URL for rendering the photo, if one has been uploaded. */
  photoUrl: string | null;
  source: GuestSource;
  createdAt: string;
  /** Id of the Group this guest belongs to, or null. A guest belongs to at most one group. */
  groupId: string | null;
}

export interface NewGuest {
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
  source: GuestSource;
}

export interface GuestUpdate {
  firstName?: string;
  lastName?: string;
  bracket?: GuestBracket;
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

export interface VotingStatus {
  isOpen: boolean;
  resultsPublished: boolean;
}
