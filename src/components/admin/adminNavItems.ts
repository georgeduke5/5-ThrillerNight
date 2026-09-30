export interface AdminNavItem {
  href: string;
  label: string;
  /**
   * Subtitle shown on the Home page's quick-link card for this page. Not
   * used by AdminNav itself, but kept alongside href/label here (rather
   * than a separate list on the Home page) so the two can never drift out
   * of sync — adding, removing, or reordering a page only ever happens in
   * this one array.
   */
  description: string;
}

/**
 * Single source of truth for every page in the admin portal's nav — both
 * AdminNav (the sidebar/hamburger menu) and the Home page's quick-link grid
 * render directly off this array, in this order, so the two can never list
 * a different set of pages or disagree on ordering. Home excludes its own
 * entry (href "/admin") since a "Home" button on the Home page would be a
 * self-link to nowhere.
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    href: "/admin",
    label: "Home",
    description: "Jump to any admin page.",
  },
  {
    href: "/admin/check-in",
    label: "Check-In",
    description: "Approve or clear guests awaiting review after a no-phone passkey registration.",
  },
  {
    href: "/admin/guests",
    label: "Guests",
    description: "Add/edit guests, photos, and view voted status.",
  },
  {
    href: "/admin/groups",
    label: "Groups",
    description: "Add/edit Couple or Group costume entries and manage their members.",
  },
  {
    href: "/admin/voting",
    label: "Costume Contest",
    description: "View turnout stats and live results by category.",
  },
  {
    href: "/admin/candy-count",
    label: "Candy Count",
    description: "Open/close guessing, enter the true count, and view standings.",
  },
  {
    href: "/admin/security",
    label: "Security",
    description: "Phone verification, passkey login, and self-service walk-in settings.",
  },
  {
    href: "/admin/import",
    label: "Import CSV",
    description: "Bulk-import guests from an Evite export.",
  },
];
