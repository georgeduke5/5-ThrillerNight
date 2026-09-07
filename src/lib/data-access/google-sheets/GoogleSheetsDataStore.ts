import "server-only";
import { v4 as uuidv4 } from "uuid";
import type { GuestBracket } from "@/lib/config/types";
import type { DataStore } from "../DataStore";
import type {
  Group,
  GroupUpdate,
  Guest,
  GuestUpdate,
  GuestSource,
  NewGroup,
  NewGuest,
  NewVote,
  Vote,
  VotingStatus,
} from "../types";
import { SheetTable } from "./SheetTable";

const VALID_BRACKETS: GuestBracket[] = ["adult-male", "adult-female", "boy", "girl"];

type GuestRow = {
  id: string;
  firstName: string;
  lastName: string;
  bracket: string;
  photoRef: string;
  photoUrl: string;
  source: string;
  createdAt: string;
  groupId: string;
  phone: string;
  checkedInAt: string;
};

type VoteRow = {
  voterGuestId: string;
  category: string;
  nomineeId: string;
  timestamp: string;
};

type GroupRow = {
  id: string;
  name: string;
  photoRef: string;
  photoUrl: string;
  /** Comma-joined guest ids. Safe: guest ids are uuidv4 and never contain commas. */
  memberIds: string;
  createdAt: string;
};

type SettingRow = {
  key: string;
  value: string;
};

const GUEST_HEADERS: (keyof GuestRow)[] = [
  "id",
  "firstName",
  "lastName",
  "bracket",
  "photoRef",
  "photoUrl",
  "source",
  "createdAt",
  "groupId",
  "phone",
  "checkedInAt",
];
const VOTE_HEADERS: (keyof VoteRow)[] = ["voterGuestId", "category", "nomineeId", "timestamp"];
const GROUP_HEADERS: (keyof GroupRow)[] = ["id", "name", "photoRef", "photoUrl", "memberIds", "createdAt"];
const SETTING_HEADERS: (keyof SettingRow)[] = ["key", "value"];

const VOTING_OPEN_KEY = "votingOpen";
const RESULTS_PUBLISHED_KEY = "resultsPublished";

function rowToGuest(row: GuestRow): Guest {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    bracket: (VALID_BRACKETS.includes(row.bracket as GuestBracket)
      ? row.bracket
      : "adult-male") as GuestBracket,
    photoRef: row.photoRef || null,
    photoUrl: row.photoUrl || null,
    source: (row.source || "manual") as GuestSource,
    createdAt: row.createdAt,
    groupId: row.groupId || null,
    phone: row.phone || null,
    checkedInAt: row.checkedInAt || null,
  };
}

function guestToRow(guest: Guest): GuestRow {
  return {
    id: guest.id,
    firstName: sanitizeForSheets(guest.firstName),
    lastName: sanitizeForSheets(guest.lastName),
    bracket: guest.bracket,
    photoRef: guest.photoRef ?? "",
    photoUrl: guest.photoUrl ?? "",
    source: guest.source,
    createdAt: guest.createdAt,
    groupId: guest.groupId ?? "",
    phone: guest.phone ? sanitizeForSheets(guest.phone) : "",
    checkedInAt: guest.checkedInAt ?? "",
  };
}

function rowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: row.name,
    photoRef: row.photoRef || null,
    photoUrl: row.photoUrl || null,
    memberIds: row.memberIds ? row.memberIds.split(",").filter(Boolean) : [],
    createdAt: row.createdAt,
  };
}

function groupToRow(group: Group): GroupRow {
  return {
    id: group.id,
    name: sanitizeForSheets(group.name),
    photoRef: group.photoRef ?? "",
    photoUrl: group.photoUrl ?? "",
    memberIds: group.memberIds.join(","),
    createdAt: group.createdAt,
  };
}

/**
 * An all-blank row for the given headers. Writing this over an existing row
 * is how this store "deletes" a row without needing the Sheets API's
 * dimension-delete call (which needs the tab's numeric sheetId, not just its
 * name) — SheetTable.getAllRows() already filters out any row whose values
 * are all blank, so this is equivalent to deletion from the app's view.
 */
function blankRow<T extends Record<string, string>>(headers: ReadonlyArray<keyof T & string>): T {
  const row = {} as Record<string, string>;
  headers.forEach((header) => {
    row[header] = "";
  });
  return row as T;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@"];

/**
 * Guards against CSV/formula injection (CWE-1236): a guest name (or group
 * name, or admin-entered phone) beginning with =, +, -, or @ would be
 * interpreted by Sheets/Excel as a formula if opened by an admin, rather
 * than as plain text — e.g. a walk-in guest registering as
 * `=HYPERLINK("http://evil.example","click")` as their first name. Prefixing
 * with a leading apostrophe forces Sheets to treat the cell as text; Sheets
 * strips that apostrophe from the value it returns on read, so this is
 * transparent to every row-mapping round-trip and needs no special
 * handling on the read side. Applied here, at the single point every guest
 * and group write funnels through (guestToRow/groupToRow), so it covers
 * manual admin entry, walk-in self-registration, and CSV import alike
 * without each of those needing to duplicate it.
 */
function sanitizeForSheets(value: string): string {
  return FORMULA_TRIGGER_CHARS.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;
}

/**
 * Google Sheets–backed implementation of DataStore. Expects four tabs in
 * the target spreadsheet — "Guests", "Votes", "Groups", "Settings" — each
 * with a header row matching the *_HEADERS constants above. See README.md
 * for the exact sheet setup.
 */
export class GoogleSheetsDataStore implements DataStore {
  private readonly guests = new SheetTable<GuestRow>("Guests", GUEST_HEADERS);
  private readonly votes = new SheetTable<VoteRow>("Votes", VOTE_HEADERS);
  private readonly groups = new SheetTable<GroupRow>("Groups", GROUP_HEADERS);
  private readonly settings = new SheetTable<SettingRow>("Settings", SETTING_HEADERS);

  async getGuests(): Promise<Guest[]> {
    const rows = await this.guests.getAllRows();
    return rows.map((r) => rowToGuest(r.values));
  }

  async getGuestById(id: string): Promise<Guest | null> {
    const rows = await this.guests.getAllRows();
    const match = rows.find((r) => r.values.id === id);
    return match ? rowToGuest(match.values) : null;
  }

  async findGuestByName(firstName: string, lastName: string): Promise<Guest | null> {
    const rows = await this.guests.getAllRows();
    const match = rows.find(
      (r) =>
        normalizeName(r.values.firstName) === normalizeName(firstName) &&
        normalizeName(r.values.lastName) === normalizeName(lastName),
    );
    return match ? rowToGuest(match.values) : null;
  }

  async addGuest(newGuest: NewGuest): Promise<Guest> {
    const [guest] = await this.addGuests([newGuest]);
    if (!guest) throw new Error("Failed to add guest");
    return guest;
  }

  async addGuests(newGuests: NewGuest[]): Promise<Guest[]> {
    const now = new Date().toISOString();
    const guests: Guest[] = newGuests.map((g) => ({
      id: uuidv4(),
      firstName: g.firstName.trim(),
      lastName: g.lastName.trim(),
      bracket: g.bracket,
      photoRef: null,
      photoUrl: null,
      source: g.source,
      createdAt: now,
      groupId: null,
      phone: g.phone?.trim() || null,
      checkedInAt: null,
    }));
    await this.guests.appendRows(guests.map(guestToRow));
    return guests;
  }

  async updateGuest(id: string, updates: GuestUpdate): Promise<Guest> {
    const rows = await this.guests.getAllRows();
    const match = rows.find((r) => r.values.id === id);
    if (!match) throw new Error(`Guest not found: ${id}`);
    const updated = rowToGuest(match.values);
    if (updates.firstName !== undefined) updated.firstName = updates.firstName.trim();
    if (updates.lastName !== undefined) updated.lastName = updates.lastName.trim();
    if (updates.bracket !== undefined) updated.bracket = updates.bracket;
    if (updates.phone !== undefined) updated.phone = updates.phone?.trim() || null;
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
    return updated;
  }

  async deleteGuest(id: string): Promise<void> {
    const guestRows = await this.guests.getAllRows();
    const match = guestRows.find((r) => r.values.id === id);
    if (!match) throw new Error(`Guest not found: ${id}`);

    // Reuses removeGuestFromGroup so a deleted guest doesn't linger in a
    // group's member list — it also clears the about-to-be-deleted guest's
    // own groupId, which is redundant with the blankRow write just below,
    // but keeping the logic in one place is worth one extra write.
    const guest = rowToGuest(match.values);
    if (guest.groupId) {
      await this.removeGuestFromGroup(guest.groupId, id);
    }

    await this.guests.updateRow(match.rowNumber, blankRow(GUEST_HEADERS));

    const voteRows = await this.votes.getAllRows();
    const relatedVotes = voteRows.filter(
      (r) => r.values.voterGuestId === id || r.values.nomineeId === id,
    );
    await Promise.all(
      relatedVotes.map((r) => this.votes.updateRow(r.rowNumber, blankRow(VOTE_HEADERS))),
    );
  }

  async markGuestCheckedIn(guestId: string): Promise<void> {
    const rows = await this.guests.getAllRows();
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new Error(`Guest not found: ${guestId}`);
    if (match.values.checkedInAt) return; // already checked in — keep the first timestamp
    const updated = rowToGuest(match.values);
    updated.checkedInAt = new Date().toISOString();
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
  }

  async savePhotoReference(guestId: string, photoRef: string, photoUrl: string): Promise<void> {
    const rows = await this.guests.getAllRows();
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new Error(`Guest not found: ${guestId}`);
    const updated = rowToGuest(match.values);
    updated.photoRef = photoRef;
    updated.photoUrl = photoUrl;
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
  }

  /** Internal — groupId isn't part of the public GuestUpdate surface; only group endpoints set or clear it. */
  private async setGuestGroupId(guestId: string, groupId: string | null): Promise<void> {
    const rows = await this.guests.getAllRows();
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new Error(`Guest not found: ${guestId}`);
    const updated = rowToGuest(match.values);
    updated.groupId = groupId;
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
  }

  async getGroups(): Promise<Group[]> {
    const rows = await this.groups.getAllRows();
    return rows.map((r) => rowToGroup(r.values));
  }

  async getGroupById(id: string): Promise<Group | null> {
    const rows = await this.groups.getAllRows();
    const match = rows.find((r) => r.values.id === id);
    return match ? rowToGroup(match.values) : null;
  }

  async addGroup(newGroup: NewGroup): Promise<Group> {
    const creator = await this.getGuestById(newGroup.creatorGuestId);
    if (!creator) throw new Error(`Guest not found: ${newGroup.creatorGuestId}`);
    if (creator.groupId) throw new Error("Guest is already in a group.");

    const group: Group = {
      id: uuidv4(),
      name: newGroup.name.trim(),
      photoRef: null,
      photoUrl: null,
      memberIds: [newGroup.creatorGuestId],
      createdAt: new Date().toISOString(),
    };
    await this.groups.appendRow(groupToRow(group));
    // Not atomic — two sequential writes, matching this store's existing
    // no-transaction posture (see recordVote).
    await this.setGuestGroupId(newGroup.creatorGuestId, group.id);
    return group;
  }

  async addGuestToGroup(groupId: string, guestId: string, actingGuestId: string): Promise<Group> {
    const rows = await this.groups.getAllRows();
    const match = rows.find((r) => r.values.id === groupId);
    if (!match) throw new Error(`Group not found: ${groupId}`);

    const guest = await this.getGuestById(guestId);
    if (!guest) throw new Error(`Guest not found: ${guestId}`);
    if (guest.groupId) throw new Error("Guest is already in a group.");

    const group = rowToGroup(match.values);
    // Self-service joining is always allowed; adding someone *else* requires
    // the adder to already be a member.
    if (actingGuestId !== guestId && !group.memberIds.includes(actingGuestId)) {
      throw new Error("Only current group members can add other guests.");
    }

    group.memberIds = [...group.memberIds, guestId];
    await this.groups.updateRow(match.rowNumber, groupToRow(group));
    await this.setGuestGroupId(guestId, groupId);
    return group;
  }

  async removeGuestFromGroup(groupId: string, guestId: string): Promise<void> {
    const rows = await this.groups.getAllRows();
    const match = rows.find((r) => r.values.id === groupId);
    if (!match) throw new Error(`Group not found: ${groupId}`);

    const guest = await this.getGuestById(guestId);
    if (!guest) throw new Error(`Guest not found: ${guestId}`);

    const group = rowToGroup(match.values);
    if (group.memberIds.includes(guestId)) {
      group.memberIds = group.memberIds.filter((memberId) => memberId !== guestId);
      await this.groups.updateRow(match.rowNumber, groupToRow(group));
    }
    if (guest.groupId === groupId) {
      await this.setGuestGroupId(guestId, null);
    }
  }

  async updateGroup(id: string, updates: GroupUpdate): Promise<Group> {
    const rows = await this.groups.getAllRows();
    const match = rows.find((r) => r.values.id === id);
    if (!match) throw new Error(`Group not found: ${id}`);
    const updated = rowToGroup(match.values);
    if (updates.name !== undefined) updated.name = updates.name.trim();
    await this.groups.updateRow(match.rowNumber, groupToRow(updated));
    return updated;
  }

  async deleteGroup(id: string): Promise<void> {
    const rows = await this.groups.getAllRows();
    const match = rows.find((r) => r.values.id === id);
    if (!match) throw new Error(`Group not found: ${id}`);
    await this.groups.updateRow(match.rowNumber, blankRow(GROUP_HEADERS));

    const guestRows = await this.guests.getAllRows();
    const members = guestRows.filter((r) => r.values.groupId === id);
    await Promise.all(members.map((r) => this.setGuestGroupId(r.values.id, null)));
  }

  async saveGroupPhotoReference(groupId: string, photoRef: string, photoUrl: string): Promise<void> {
    const rows = await this.groups.getAllRows();
    const match = rows.find((r) => r.values.id === groupId);
    if (!match) throw new Error(`Group not found: ${groupId}`);
    const updated = rowToGroup(match.values);
    updated.photoRef = photoRef;
    updated.photoUrl = photoUrl;
    await this.groups.updateRow(match.rowNumber, groupToRow(updated));
  }

  async recordVote(vote: NewVote): Promise<Vote> {
    const rows = await this.votes.getAllRows();
    const timestamp = new Date().toISOString();
    const row: VoteRow = {
      voterGuestId: vote.voterGuestId,
      category: vote.category,
      nomineeId: vote.nomineeId,
      timestamp,
    };
    const existing = rows.find(
      (r) => r.values.voterGuestId === vote.voterGuestId && r.values.category === vote.category,
    );
    if (existing) {
      await this.votes.updateRow(existing.rowNumber, row);
    } else {
      await this.votes.appendRow(row);
    }
    return row;
  }

  async getVotes(): Promise<Vote[]> {
    const rows = await this.votes.getAllRows();
    return rows.map((r) => r.values);
  }

  async getVotingStatus(): Promise<VotingStatus> {
    const rows = await this.settings.getAllRows();
    const isOpen = rows.find((r) => r.values.key === VOTING_OPEN_KEY)?.values.value === "true";
    const resultsPublished =
      rows.find((r) => r.values.key === RESULTS_PUBLISHED_KEY)?.values.value === "true";
    return { isOpen, resultsPublished };
  }

  async setVotingOpen(isOpen: boolean): Promise<void> {
    await this.upsertSetting(VOTING_OPEN_KEY, String(isOpen));
  }

  async setResultsPublished(published: boolean): Promise<void> {
    await this.upsertSetting(RESULTS_PUBLISHED_KEY, String(published));
  }

  private async upsertSetting(key: string, value: string): Promise<void> {
    const rows = await this.settings.getAllRows();
    const existing = rows.find((r) => r.values.key === key);
    if (existing) {
      await this.settings.updateRow(existing.rowNumber, { key, value });
    } else {
      await this.settings.appendRow({ key, value });
    }
  }
}
