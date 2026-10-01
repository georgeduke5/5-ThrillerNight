import type { Guest } from "@/lib/data-access";

export type GuestCheckInStatus = "none" | "pending" | "approved";

/**
 * Derives a guest's check-in status from the two existing timestamp fields
 * rather than a separate column: checkedInAt and pendingApprovalAt are
 * already mutually exclusive and already the source of truth everywhere a
 * guest's status is set (see DataStore.markGuestCheckedIn /
 * markGuestPendingApproval / approvePendingGuest / rejectPendingGuest). This
 * just names the three resulting states so re-entry logic — passkey
 * re-authentication, the phone fallback, and the pending-guest page
 * lockdown — can reason about "what is this guest's status right now" in
 * one place instead of re-deriving the same two-field check at every call
 * site.
 */
export function getGuestCheckInStatus(
  guest: Pick<Guest, "checkedInAt" | "pendingApprovalAt">,
): GuestCheckInStatus {
  if (guest.checkedInAt) return "approved";
  if (guest.pendingApprovalAt) return "pending";
  return "none";
}
