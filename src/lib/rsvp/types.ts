import type { GuestBracket } from "@/lib/config/types";

/**
 * Phase 1 stub only — not wired to any storage or form submission yet.
 *
 * Deliberately reuses the same person shape as the guest/nominee data
 * structure (see src/lib/data-access/types.ts Guest/NewGuest: firstName,
 * lastName, bracket) plus the RSVP-only fields from requirements
 * Section 6.2 (email, household), so that when Phase 2 wires this module
 * up for real, RSVP submissions can populate the Voting module's guest list
 * directly instead of the Section 5.1 manual/CSV-import stand-in — without
 * reshaping either side.
 */
export interface RsvpPerson {
  firstName: string;
  lastName: string;
  bracket: GuestBracket;
  /** Required for the primary registrant, optional for additional household members. */
  email?: string;
}

export interface RsvpHouseholdSubmission {
  primaryRegistrant: RsvpPerson;
  additionalGuests: RsvpPerson[];
  foodItem?: string;
}
