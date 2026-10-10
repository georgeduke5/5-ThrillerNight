import "server-only";
import { v4 as uuidv4 } from "uuid";
import type { GuestBracket } from "@/lib/config/types";
import type { DataStore } from "../DataStore";
import type {
  CandyCountStatus,
  CandyGuess,
  Group,
  GroupUpdate,
  Guest,
  GuestPasskey,
  GuestUpdate,
  GuestSource,
  NewCandyGuess,
  NewGroup,
  NewGuest,
  NewVote,
  Vote,
  VotingStatus,
} from "../types";
import { SheetTable } from "./SheetTable";
import type { ReadCacheOptions } from "./sheetReadCache";
import { desanitizeFromSheets, sanitizeForSheets } from "./sanitizeForSheets";
import { decryptPhone, encryptPhone, isEncryptedPhone } from "./phoneEncryption";
import { PublicError } from "@/lib/errors";

const VALID_BRACKETS: GuestBracket[] = ["adult-male", "adult-female", "boy", "girl"];

export type GuestRow = {
  id: string;
  firstName: string;
  lastName: string;
  bracket: string;
  photoRef: string;
  photoUrl: string;
  source: string;
  createdAt: string;
  groupId: string;
  /** Encrypted at rest — see phoneEncryption.ts. May still be a legacy plaintext value on a row the one-time migration hasn't reached yet; rowToGuest handles both. */
  phone: string;
  checkedInAt: string;
  pendingApprovalAt: string;
  isAdmin: string;
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

type PasskeyRow = {
  guestId: string;
  credentialId: string;
  publicKey: string;
  counter: string;
  /** Comma-joined transport hints. Safe: transport values are a fixed vocabulary with no commas. */
  transports: string;
  createdAt: string;
};

type CandyGuessRow = {
  guestId: string;
  guestName: string;
  guess: string;
  timestamp: string;
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
  "pendingApprovalAt",
  "isAdmin",
];
const VOTE_HEADERS: (keyof VoteRow)[] = ["voterGuestId", "category", "nomineeId", "timestamp"];
const GROUP_HEADERS: (keyof GroupRow)[] = ["id", "name", "photoRef", "photoUrl", "memberIds", "createdAt"];
const SETTING_HEADERS: (keyof SettingRow)[] = ["key", "value"];
const PASSKEY_HEADERS: (keyof PasskeyRow)[] = [
  "guestId",
  "credentialId",
  "publicKey",
  "counter",
  "transports",
  "createdAt",
];
const CANDY_GUESS_HEADERS: (keyof CandyGuessRow)[] = ["guestId", "guestName", "guess", "timestamp"];

const VOTING_OPEN_KEY = "votingOpen";
const RESULTS_PUBLISHED_KEY = "resultsPublished";
const PHONE_VERIFICATION_ENABLED_KEY = "phoneVerificationEnabled";
const PASSKEY_AUTH_ENABLED_KEY = "passkeyAuthEnabled";
const SELF_SERVICE_WALKIN_ENABLED_KEY = "selfServiceWalkinEnabled";
const IN_PERSON_CHECKIN_ENABLED_KEY = "inPersonCheckInEnabled";
const CANDY_GUESSING_OPEN_KEY = "candyGuessingOpen";
const CANDY_RESULTS_PUBLISHED_KEY = "candyResultsPublished";
const CANDY_TRUE_COUNT_KEY = "candyTrueCount";

/**
 * Reads whatever is currently in the phone cell: an already-encrypted
 * value (the normal case going forward — see phoneEncryption.ts) or a
 * legacy plaintext value left over from before field-level encryption
 * existed, desanitized the same way every other free-text field is. Lets
 * the app keep working correctly on a row the one-time migration
 * (DataStore.migratePlaintextPhones) hasn't reached yet, and self-heals:
 * any future update to that guest row re-encrypts it via guestToRow below,
 * regardless of which branch here produced the value that went in.
 */
function decodeStoredPhone(value: string): string {
  return isEncryptedPhone(value) ? decryptPhone(value) : desanitizeFromSheets(value);
}

export function rowToGuest(row: GuestRow): Guest {
  return {
    id: row.id,
    firstName: desanitizeFromSheets(row.firstName),
    lastName: desanitizeFromSheets(row.lastName),
    bracket: (VALID_BRACKETS.includes(row.bracket as GuestBracket)
      ? row.bracket
      : "adult-male") as GuestBracket,
    photoRef: row.photoRef || null,
    photoUrl: row.photoUrl || null,
    source: (row.source || "manual") as GuestSource,
    createdAt: row.createdAt,
    groupId: row.groupId || null,
    phone: row.phone ? decodeStoredPhone(row.phone) : null,
    checkedInAt: row.checkedInAt || null,
    pendingApprovalAt: row.pendingApprovalAt || null,
    // Plain-text cell, not a Sheets checkbox — case-insensitive "true" is
    // the only value that grants admin access; anything else (blank, a
    // typo, "false") reads as false. George sets this directly in the
    // sheet; see Guest.isAdmin.
    isAdmin: row.isAdmin?.trim().toLowerCase() === "true",
  };
}

export function guestToRow(guest: Guest): GuestRow {
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
    // Encrypted immediately before the write, every time, regardless of
    // which code path produced this Guest object — never sanitizeForSheets
    // here (unlike firstName/lastName): the fixed "enc:v1:" prefix already
    // guarantees the cell never starts with a formula-trigger character.
    phone: guest.phone ? encryptPhone(guest.phone) : "",
    checkedInAt: guest.checkedInAt ?? "",
    pendingApprovalAt: guest.pendingApprovalAt ?? "",
    isAdmin: guest.isAdmin ? "true" : "",
  };
}

function rowToGroup(row: GroupRow): Group {
  return {
    id: row.id,
    name: desanitizeFromSheets(row.name),
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

function rowToPasskey(row: PasskeyRow): GuestPasskey {
  return {
    guestId: row.guestId,
    credentialId: row.credentialId,
    publicKey: row.publicKey,
    // A blank/garbled counter reads as 0, which is also what authenticators
    // that don't implement a counter report — the safe floor either way.
    counter: Number.parseInt(row.counter, 10) || 0,
    transports: row.transports ? row.transports.split(",").filter(Boolean) : [],
    createdAt: row.createdAt,
  };
}

function passkeyToRow(passkey: GuestPasskey): PasskeyRow {
  return {
    guestId: passkey.guestId,
    credentialId: passkey.credentialId,
    publicKey: passkey.publicKey,
    counter: String(passkey.counter),
    transports: passkey.transports.join(","),
    createdAt: passkey.createdAt,
  };
}

function rowToCandyGuess(row: CandyGuessRow): CandyGuess {
  return {
    guestId: row.guestId,
    guestName: desanitizeFromSheets(row.guestName),
    guess: Number.parseInt(row.guess, 10) || 0,
    timestamp: row.timestamp,
  };
}

function candyGuessToRow(guess: CandyGuess): CandyGuessRow {
  return {
    guestId: guess.guestId,
    guestName: sanitizeForSheets(guess.guestName),
    // Defensive: by the time a guess reaches here it's already been
    // validated as a plain non-negative integer (see POST /api/candy-count),
    // so String(guess.guess) can never actually start with a trigger
    // character — but this is the one shared point every write funnels
    // through, so it's sanitized unconditionally in case that validation is
    // ever bypassed or this method gets a new caller that skips it.
    guess: sanitizeForSheets(String(guess.guess)),
    timestamp: guess.timestamp,
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

/**
 * Google Sheets–backed implementation of DataStore. Expects six tabs in
 * the target spreadsheet — "Guests", "Votes", "Groups", "Settings",
 * "Passkeys", "CandyGuesses" — each with a header row matching the
 * *_HEADERS constants above. See README.md for the exact sheet setup.
 */
export class GoogleSheetsDataStore implements DataStore {
  private readonly guests = new SheetTable<GuestRow>("Guests", GUEST_HEADERS);
  private readonly votes = new SheetTable<VoteRow>("Votes", VOTE_HEADERS);
  private readonly groups = new SheetTable<GroupRow>("Groups", GROUP_HEADERS);
  private readonly settings = new SheetTable<SettingRow>("Settings", SETTING_HEADERS);
  private readonly passkeys = new SheetTable<PasskeyRow>("Passkeys", PASSKEY_HEADERS);
  private readonly candyGuesses = new SheetTable<CandyGuessRow>("CandyGuesses", CANDY_GUESS_HEADERS);

  async getGuests(): Promise<Guest[]> {
    const rows = await this.guests.getAllRows();
    return rows.map((r) => rowToGuest(r.values));
  }

  /**
   * `options.fresh` is for internal callers that use this result to gate a
   * write (addGroup/addGuestToGroup/removeGuestFromGroup's "already in a
   * group" checks) — every external caller (route handlers, proxy.ts's
   * auth check) omits it and gets the cached, faster path.
   */
  async getGuestById(id: string, options: ReadCacheOptions = {}): Promise<Guest | null> {
    const rows = await this.guests.getAllRows(options);
    const match = rows.find((r) => r.values.id === id);
    return match ? rowToGuest(match.values) : null;
  }

  async findGuestByName(firstName: string, lastName: string): Promise<Guest | null> {
    const rows = await this.guests.getAllRows();
    const match = rows.find(
      (r) =>
        // Compares against the desanitized value — r.values.firstName is the
        // raw stored cell, which still carries sanitizeForSheets' leading
        // apostrophe (RAW writes never get that stripped by Sheets itself;
        // see sanitizeForSheets.ts) for any guest whose name triggers it.
        normalizeName(desanitizeFromSheets(r.values.firstName)) === normalizeName(firstName) &&
        normalizeName(desanitizeFromSheets(r.values.lastName)) === normalizeName(lastName),
    );
    return match ? rowToGuest(match.values) : null;
  }

  async addGuest(newGuest: NewGuest): Promise<Guest> {
    const [guest] = await this.addGuests([newGuest]);
    if (!guest) throw new PublicError("Failed to add guest");
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
      pendingApprovalAt: null,
      isAdmin: false,
    }));
    await this.guests.appendRows(guests.map(guestToRow));
    return guests;
  }

  async updateGuest(id: string, updates: GuestUpdate): Promise<Guest> {
    const rows = await this.guests.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === id);
    if (!match) throw new PublicError(`Guest not found: ${id}`);
    const updated = rowToGuest(match.values);
    if (updates.firstName !== undefined) updated.firstName = updates.firstName.trim();
    if (updates.lastName !== undefined) updated.lastName = updates.lastName.trim();
    if (updates.bracket !== undefined) updated.bracket = updates.bracket;
    if (updates.phone !== undefined) updated.phone = updates.phone?.trim() || null;
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
    return updated;
  }

  async deleteGuest(id: string): Promise<void> {
    const guestRows = await this.guests.getAllRows({ fresh: true });
    const match = guestRows.find((r) => r.values.id === id);
    if (!match) throw new PublicError(`Guest not found: ${id}`);

    // Reuses removeGuestFromGroup so a deleted guest doesn't linger in a
    // group's member list — it also clears the about-to-be-deleted guest's
    // own groupId, which is redundant with the blankRow write just below,
    // but keeping the logic in one place is worth one extra write.
    const guest = rowToGuest(match.values);
    if (guest.groupId) {
      await this.removeGuestFromGroup(guest.groupId, id);
    }

    await this.guests.updateRow(match.rowNumber, blankRow(GUEST_HEADERS));

    const voteRows = await this.votes.getAllRows({ fresh: true });
    const relatedVotes = voteRows.filter(
      (r) => r.values.voterGuestId === id || r.values.nomineeId === id,
    );
    await Promise.all(
      relatedVotes.map((r) => this.votes.updateRow(r.rowNumber, blankRow(VOTE_HEADERS))),
    );

    // Same reasoning as the votes above: leave no credential pointing at a
    // guest row that no longer exists. Re-adding a guest with the same name
    // creates a new id, so a stale row could never be reattached anyway.
    //
    // Tolerates the "Passkeys" tab not existing: it's only required once
    // passkey login is switched on, and a spreadsheet set up before that
    // feature shipped shouldn't have guest deletion start failing on a tab
    // it has no rows in anyway.
    try {
      const passkeyRows = await this.passkeys.getAllRows({ fresh: true });
      await Promise.all(
        passkeyRows
          .filter((r) => r.values.guestId === id)
          .map((r) => this.passkeys.updateRow(r.rowNumber, blankRow(PASSKEY_HEADERS))),
      );
    } catch (err) {
      console.error(`Could not clear passkeys for deleted guest ${id}:`, err);
    }

    // Same reasoning again: no candy guess should be left pointing at a
    // guest row that no longer exists. Tolerates the "CandyGuesses" tab not
    // existing yet, same as Passkeys above.
    try {
      const candyRows = await this.candyGuesses.getAllRows({ fresh: true });
      await Promise.all(
        candyRows
          .filter((r) => r.values.guestId === id)
          .map((r) => this.candyGuesses.updateRow(r.rowNumber, blankRow(CANDY_GUESS_HEADERS))),
      );
    } catch (err) {
      console.error(`Could not clear candy guesses for deleted guest ${id}:`, err);
    }
  }

  /**
   * One-time, idempotent, safely re-runnable migration: re-writes every
   * guest row whose phone cell predates field-level encryption (plaintext,
   * not "enc:v1:"-prefixed) so it's encrypted going forward. Skips rows
   * with no phone or an already-encrypted one, so running it twice (or on
   * a Sheet that's already fully migrated) is a harmless no-op. Never logs
   * or returns a phone number, only counts — see
   * POST /api/admin/migrate-phone-encryption and PRODUCTION_DEPLOY.md.
   */
  async migratePlaintextPhones(): Promise<{ migrated: number; alreadyEncrypted: number; skippedEmpty: number }> {
    const rows = await this.guests.getAllRows({ fresh: true });
    let migrated = 0;
    let alreadyEncrypted = 0;
    let skippedEmpty = 0;

    for (const row of rows) {
      const rawPhone = row.values.phone;
      if (!rawPhone) {
        skippedEmpty++;
        continue;
      }
      if (isEncryptedPhone(rawPhone)) {
        alreadyEncrypted++;
        continue;
      }
      // Round-trips through the exact same decode/encode path every other
      // guest write uses: rowToGuest already knows how to read a legacy
      // plaintext cell, and guestToRow always encrypts on the way back out.
      await this.guests.updateRow(row.rowNumber, guestToRow(rowToGuest(row.values)));
      migrated++;
    }

    return { migrated, alreadyEncrypted, skippedEmpty };
  }

  async markGuestCheckedIn(guestId: string): Promise<void> {
    const rows = await this.guests.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new PublicError(`Guest not found: ${guestId}`);
    if (match.values.checkedInAt) return; // already checked in — keep the first timestamp
    const updated = rowToGuest(match.values);
    updated.checkedInAt = new Date().toISOString();
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
  }

  async markGuestPendingApproval(guestId: string): Promise<void> {
    const rows = await this.guests.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new PublicError(`Guest not found: ${guestId}`);
    if (match.values.checkedInAt || match.values.pendingApprovalAt) return;
    const updated = rowToGuest(match.values);
    updated.pendingApprovalAt = new Date().toISOString();
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
  }

  async approvePendingGuest(guestId: string): Promise<void> {
    const rows = await this.guests.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new PublicError(`Guest not found: ${guestId}`);
    const updated = rowToGuest(match.values);
    updated.pendingApprovalAt = null;
    if (!updated.checkedInAt) updated.checkedInAt = new Date().toISOString();
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
  }

  async rejectPendingGuest(guestId: string): Promise<void> {
    const rows = await this.guests.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new PublicError(`Guest not found: ${guestId}`);
    const updated = rowToGuest(match.values);
    updated.pendingApprovalAt = null;
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));

    // Resets the identity to a genuine zero-passkey state, same as if this
    // guest had never registered — the real guest can then register
    // correctly from scratch.
    await this.deletePasskey(guestId);
  }

  async savePhotoReference(guestId: string, photoRef: string, photoUrl: string): Promise<void> {
    const rows = await this.guests.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new PublicError(`Guest not found: ${guestId}`);
    const updated = rowToGuest(match.values);
    updated.photoRef = photoRef;
    updated.photoUrl = photoUrl;
    await this.guests.updateRow(match.rowNumber, guestToRow(updated));
  }

  /** Internal — groupId isn't part of the public GuestUpdate surface; only group endpoints set or clear it. */
  private async setGuestGroupId(guestId: string, groupId: string | null): Promise<void> {
    const rows = await this.guests.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === guestId);
    if (!match) throw new PublicError(`Guest not found: ${guestId}`);
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
    const creator = await this.getGuestById(newGroup.creatorGuestId, { fresh: true });
    if (!creator) throw new PublicError(`Guest not found: ${newGroup.creatorGuestId}`);
    if (creator.groupId) throw new PublicError("Guest is already in a group.");

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
    const rows = await this.groups.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === groupId);
    if (!match) throw new PublicError(`Group not found: ${groupId}`);

    const guest = await this.getGuestById(guestId, { fresh: true });
    if (!guest) throw new PublicError(`Guest not found: ${guestId}`);
    if (guest.groupId) throw new PublicError("Guest is already in a group.");

    const group = rowToGroup(match.values);
    // Self-service joining is always allowed; adding someone *else* requires
    // the adder to already be a member.
    if (actingGuestId !== guestId && !group.memberIds.includes(actingGuestId)) {
      throw new PublicError("Only current group members can add other guests.");
    }

    group.memberIds = [...group.memberIds, guestId];
    await this.groups.updateRow(match.rowNumber, groupToRow(group));
    await this.setGuestGroupId(guestId, groupId);
    return group;
  }

  async removeGuestFromGroup(groupId: string, guestId: string): Promise<void> {
    const rows = await this.groups.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === groupId);
    if (!match) throw new PublicError(`Group not found: ${groupId}`);

    const guest = await this.getGuestById(guestId, { fresh: true });
    if (!guest) throw new PublicError(`Guest not found: ${guestId}`);

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
    const rows = await this.groups.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === id);
    if (!match) throw new PublicError(`Group not found: ${id}`);
    const updated = rowToGroup(match.values);
    if (updates.name !== undefined) updated.name = updates.name.trim();
    await this.groups.updateRow(match.rowNumber, groupToRow(updated));
    return updated;
  }

  async deleteGroup(id: string): Promise<void> {
    const rows = await this.groups.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === id);
    if (!match) throw new PublicError(`Group not found: ${id}`);
    await this.groups.updateRow(match.rowNumber, blankRow(GROUP_HEADERS));

    const guestRows = await this.guests.getAllRows({ fresh: true });
    const members = guestRows.filter((r) => r.values.groupId === id);
    await Promise.all(members.map((r) => this.setGuestGroupId(r.values.id, null)));
  }

  async saveGroupPhotoReference(groupId: string, photoRef: string, photoUrl: string): Promise<void> {
    const rows = await this.groups.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.id === groupId);
    if (!match) throw new PublicError(`Group not found: ${groupId}`);
    const updated = rowToGroup(match.values);
    updated.photoRef = photoRef;
    updated.photoUrl = photoUrl;
    await this.groups.updateRow(match.rowNumber, groupToRow(updated));
  }

  async recordVote(vote: NewVote): Promise<Vote> {
    const rows = await this.votes.getAllRows({ fresh: true });
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

  async getPasskeyByGuestId(guestId: string): Promise<GuestPasskey | null> {
    const rows = await this.passkeys.getAllRows();
    const match = rows.find((r) => r.values.guestId === guestId);
    return match ? rowToPasskey(match.values) : null;
  }

  async getPasskeyByCredentialId(credentialId: string): Promise<GuestPasskey | null> {
    const rows = await this.passkeys.getAllRows();
    const match = rows.find((r) => r.values.credentialId === credentialId);
    return match ? rowToPasskey(match.values) : null;
  }

  async getPasskeys(): Promise<GuestPasskey[]> {
    const rows = await this.passkeys.getAllRows();
    return rows.map((r) => rowToPasskey(r.values));
  }

  /**
   * One-passkey-per-guest, enforced here as the last line of defense (the
   * route layer already checks before starting and again before verifying
   * — see POST /api/auth/passkey/begin and finish's handleRegistration) so
   * that even two registration ceremonies racing for the same guest can't
   * both land a credential: whichever write gets here first wins, and the
   * second throws instead of silently overwriting the first. The only way
   * to clear this is DataStore.deletePasskey (the admin-only "Remove
   * Passkey" action).
   */
  async savePasskey(passkey: GuestPasskey): Promise<void> {
    const rows = await this.passkeys.getAllRows({ fresh: true });
    const existing = rows.find((r) => r.values.guestId === passkey.guestId);
    if (existing) {
      throw new PublicError("This guest already has a passkey registered.");
    }
    await this.passkeys.appendRow(passkeyToRow(passkey));
  }

  /** Admin-only "Remove Passkey" — see DELETE /api/guests/[id]/passkey. Returns false (a harmless no-op) if this guest had no passkey to begin with. */
  async deletePasskey(guestId: string): Promise<boolean> {
    const rows = await this.passkeys.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.guestId === guestId);
    if (!match) return false;
    await this.passkeys.updateRow(match.rowNumber, blankRow(PASSKEY_HEADERS));
    return true;
  }

  async updatePasskeyCounter(guestId: string, counter: number): Promise<void> {
    const rows = await this.passkeys.getAllRows({ fresh: true });
    const match = rows.find((r) => r.values.guestId === guestId);
    if (!match) throw new PublicError(`Passkey not found for guest: ${guestId}`);
    await this.passkeys.updateRow(match.rowNumber, { ...match.values, counter: String(counter) });
  }

  async getVotingStatus(): Promise<VotingStatus> {
    const rows = await this.settings.getAllRows();
    const isOpen = rows.find((r) => r.values.key === VOTING_OPEN_KEY)?.values.value === "true";
    const resultsPublished =
      rows.find((r) => r.values.key === RESULTS_PUBLISHED_KEY)?.values.value === "true";
    // Defaults to true (unlike isOpen/resultsPublished, which default
    // false): absent from Settings entirely — the common case, since this
    // is only ever written once an admin flips the kill switch — must read
    // as "verification required," not "verification off."
    const phoneVerificationEnabled =
      rows.find((r) => r.values.key === PHONE_VERIFICATION_ENABLED_KEY)?.values.value !== "false";
    // Same default-true reasoning as phoneVerificationEnabled above.
    const selfServiceWalkinEnabled =
      rows.find((r) => r.values.key === SELF_SERVICE_WALKIN_ENABLED_KEY)?.values.value !== "false";
    // Same default-true reasoning as phoneVerificationEnabled/
    // selfServiceWalkinEnabled above: absent from Settings — a fresh
    // deployment, or one that's never had this row written — must read as
    // passkey login "on." See VotingStatus.passkeyAuthEnabled.
    const passkeyAuthEnabled =
      rows.find((r) => r.values.key === PASSKEY_AUTH_ENABLED_KEY)?.values.value !== "false";
    // Same default-true reasoning as every other check-in-method toggle above.
    const inPersonCheckInEnabled =
      rows.find((r) => r.values.key === IN_PERSON_CHECKIN_ENABLED_KEY)?.values.value !== "false";
    return {
      isOpen,
      resultsPublished,
      phoneVerificationEnabled,
      passkeyAuthEnabled,
      selfServiceWalkinEnabled,
      inPersonCheckInEnabled,
    };
  }

  async setVotingOpen(isOpen: boolean): Promise<void> {
    await this.upsertSetting(VOTING_OPEN_KEY, String(isOpen));
  }

  async setResultsPublished(published: boolean): Promise<void> {
    await this.upsertSetting(RESULTS_PUBLISHED_KEY, String(published));
  }

  async setPhoneVerificationEnabled(enabled: boolean): Promise<void> {
    await this.upsertSetting(PHONE_VERIFICATION_ENABLED_KEY, String(enabled));
  }

  async setPasskeyAuthEnabled(enabled: boolean): Promise<void> {
    await this.upsertSetting(PASSKEY_AUTH_ENABLED_KEY, String(enabled));
  }

  async setSelfServiceWalkinEnabled(enabled: boolean): Promise<void> {
    await this.upsertSetting(SELF_SERVICE_WALKIN_ENABLED_KEY, String(enabled));
  }

  async setInPersonCheckInEnabled(enabled: boolean): Promise<void> {
    await this.upsertSetting(IN_PERSON_CHECKIN_ENABLED_KEY, String(enabled));
  }

  private async upsertSetting(key: string, value: string): Promise<void> {
    const rows = await this.settings.getAllRows({ fresh: true });
    const existing = rows.find((r) => r.values.key === key);
    if (existing) {
      await this.settings.updateRow(existing.rowNumber, { key, value });
    } else {
      await this.settings.appendRow({ key, value });
    }
  }

  async recordCandyGuess(guess: NewCandyGuess): Promise<CandyGuess> {
    const rows = await this.candyGuesses.getAllRows({ fresh: true });
    const timestamp = new Date().toISOString();
    const row: CandyGuess = {
      guestId: guess.guestId,
      guestName: guess.guestName,
      guess: guess.guess,
      timestamp,
    };
    const existing = rows.find((r) => r.values.guestId === guess.guestId);
    if (existing) {
      await this.candyGuesses.updateRow(existing.rowNumber, candyGuessToRow(row));
    } else {
      await this.candyGuesses.appendRow(candyGuessToRow(row));
    }
    return row;
  }

  async getCandyGuesses(): Promise<CandyGuess[]> {
    const rows = await this.candyGuesses.getAllRows();
    return rows.map((r) => rowToCandyGuess(r.values));
  }

  async getCandyGuessByGuestId(guestId: string): Promise<CandyGuess | null> {
    const rows = await this.candyGuesses.getAllRows();
    const match = rows.find((r) => r.values.guestId === guestId);
    return match ? rowToCandyGuess(match.values) : null;
  }

  async getCandyCountStatus(): Promise<CandyCountStatus> {
    const rows = await this.settings.getAllRows();
    // Same false-default reasoning as VotingStatus.isOpen/resultsPublished:
    // absent from Settings — the common case before an admin has touched
    // this contest at all — must read as closed/unpublished, not open.
    const guessingOpen =
      rows.find((r) => r.values.key === CANDY_GUESSING_OPEN_KEY)?.values.value === "true";
    const resultsPublished =
      rows.find((r) => r.values.key === CANDY_RESULTS_PUBLISHED_KEY)?.values.value === "true";
    const rawTrueCount = rows.find((r) => r.values.key === CANDY_TRUE_COUNT_KEY)?.values.value;
    const trueCount = rawTrueCount ? Number.parseInt(rawTrueCount, 10) : null;
    return {
      guessingOpen,
      resultsPublished,
      trueCount: trueCount !== null && Number.isFinite(trueCount) ? trueCount : null,
    };
  }

  async setCandyGuessingOpen(open: boolean): Promise<void> {
    await this.upsertSetting(CANDY_GUESSING_OPEN_KEY, String(open));
  }

  async setCandyResultsPublished(published: boolean): Promise<void> {
    await this.upsertSetting(CANDY_RESULTS_PUBLISHED_KEY, String(published));
  }

  async setCandyTrueCount(count: number | null): Promise<void> {
    await this.upsertSetting(CANDY_TRUE_COUNT_KEY, count === null ? "" : String(count));
  }
}
