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
