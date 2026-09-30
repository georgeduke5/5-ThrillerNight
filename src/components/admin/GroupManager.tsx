"use client";

import { useState } from "react";
import Image from "next/image";
import type { Group, Guest } from "@/lib/data-access";
import { PhotoField } from "./PhotoField";

interface GroupManagerProps {
  initialGroups: Group[];
  guests: Guest[];
  /** config.theme.placeholderImage — shown for any group with no photo uploaded. */
  placeholderImage: string;
}

interface PhotoUploadResult {
  photoUrl: string;
  photoRef: string;
}

/**
 * Admin view of Couple/Group entries — groups are normally created/joined
 * by guests themselves via the voting page's GroupPanel, but an admin can
 * also create one, add/remove members, rename, (re)assign a photo, and
 * delete a group outright, e.g. for a guest who can't do it themselves. A
 * simple list (mirroring GuestManager's list view) opens a per-group edit
 * modal on tap, rather than cramming rename/members/photo/delete into one
 * wide table row — that layout didn't fit a phone screen once a group had
 * more than a couple members.
 */
export function GroupManager({ initialGroups, guests, placeholderImage }: GroupManagerProps) {
  const [groups, setGroups] = useState(initialGroups);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editingGroup = groups.find((g) => g.id === editingGroupId) ?? null;

  function membersOf(group: Group): Guest[] {
    return guests.filter((g) => group.memberIds.includes(g.id));
  }

  // Recomputed from the live `groups` state (not each guest's own groupId
  // snapshot from page load) so a guest added to or removed from a group
  // during this session immediately drops out of / back into the pool
  // offered for "add to a group" elsewhere, without needing a page reload.
  const assignedGuestIds = new Set(groups.flatMap((g) => g.memberIds));
  const unassignedGuests = guests.filter((g) => !assignedGuestIds.has(g.id));

  async function handleAddGroup(data: { name: string; creatorGuestId: string }) {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = (await res.json().catch(() => null)) as { group?: Group; error?: string } | null;
    if (!res.ok || !body?.group) throw new Error(body?.error ?? "Failed to add group.");
    setGroups((prev) => [...prev, body.group as Group]);
  }

  async function handleRename(id: string, name: string) {
    const res = await fetch(`/api/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { group?: Group; error?: string };
    if (!res.ok || !body.group) throw new Error(body.error ?? "Failed to update group.");
    setGroups((prev) => prev.map((g) => (g.id === id ? (body.group as Group) : g)));
  }

  async function handlePhotoCropped(groupId: string, blob: Blob): Promise<void> {
    const formData = new FormData();
    formData.append("file", blob, "photo.jpg");
    formData.append("groupId", groupId);
    const res = await fetch("/api/photos", { method: "POST", body: formData });
    const body = (await res.json().catch(() => null)) as
      | ({ error?: string } & Partial<PhotoUploadResult>)
      | null;
    if (!res.ok || !body?.photoUrl) throw new Error(body?.error ?? "Failed to upload photo.");
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, photoUrl: body.photoUrl as string, photoRef: body.photoRef ?? null } : g,
      ),
    );
  }

  async function handleAddMember(groupId: string, guestId: string): Promise<void> {
    const res = await fetch(`/api/groups/${groupId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId }),
    });
    const body = (await res.json().catch(() => null)) as { group?: Group; error?: string } | null;
    if (!res.ok || !body?.group) throw new Error(body?.error ?? "Failed to add guest to group.");
    setGroups((prev) => prev.map((g) => (g.id === groupId ? (body.group as Group) : g)));
  }

  async function handleRemoveMember(groupId: string, guestId: string): Promise<void> {
    const res = await fetch(`/api/groups/${groupId}/members/${guestId}`, { method: "DELETE" });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) throw new Error(body?.error ?? "Failed to remove guest from group.");
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, memberIds: g.memberIds.filter((id) => id !== guestId) } : g,
      ),
    );
  }

  async function handleDeleteGroup(group: Group): Promise<void> {
    if (!window.confirm(`Delete the group "${group.name}"? This can't be undone.`)) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/groups/${group.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to delete group.");
      setGroups((prev) => prev.filter((g) => g.id !== group.id));
      setEditingGroupId((current) => (current === group.id ? null : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete group.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          onClick={() => setAddingGroup(true)}
          className="rounded bg-primary px-4 py-2 font-heading text-sm font-bold uppercase text-bg"
        >
          Add Group
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <GroupListView groups={groups} membersOf={membersOf} onSelect={setEditingGroupId} placeholderImage={placeholderImage} />

      {editingGroup && (
        <GroupEditModal
          group={editingGroup}
          members={membersOf(editingGroup)}
          unassignedGuests={unassignedGuests}
          onRename={(name) => handleRename(editingGroup.id, name)}
          onPhotoCropped={(blob) => handlePhotoCropped(editingGroup.id, blob)}
          onAddMember={(guestId) => handleAddMember(editingGroup.id, guestId)}
          onRemoveMember={(guestId) => handleRemoveMember(editingGroup.id, guestId)}
          onDelete={() => handleDeleteGroup(editingGroup)}
          onClose={() => setEditingGroupId(null)}
          placeholderImage={placeholderImage}
        />
      )}

      {addingGroup && (
        <GroupAddModal
          unassignedGuests={unassignedGuests}
          onAdd={handleAddGroup}
          onClose={() => setAddingGroup(false)}
        />
      )}
    </div>
  );
}

function GroupListView({
  groups,
  membersOf,
  onSelect,
  placeholderImage,
}: {
  groups: Group[];
  membersOf: (group: Group) => Guest[];
  onSelect: (id: string) => void;
  placeholderImage: string;
}) {
  return (
    <div className="surface-panel overflow-x-auto rounded-lg">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-bg text-muted">
            <th className="px-4 py-2">Photo</th>
            <th className="px-4 py-2">Name</th>
            <th className="whitespace-nowrap px-4 py-2">Members</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const memberCount = membersOf(group).length;
            return (
              <tr
                key={group.id}
                onClick={() => onSelect(group.id)}
                className="cursor-pointer border-b border-bg/50 hover:bg-bg/40"
              >
                <td className="px-4 py-2">
                  <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-bg">
                    <Image
                      src={group.photoUrl ?? placeholderImage}
                      alt={group.name}
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  </div>
                </td>
                <td className="px-4 py-2 text-text">{group.name}</td>
                <td className="whitespace-nowrap px-4 py-2 text-muted">
                  {memberCount === 0 ? "No members" : `${memberCount} member${memberCount === 1 ? "" : "s"}`}
                </td>
              </tr>
            );
          })}
          {groups.length === 0 && (
            <tr>
              <td colSpan={3} className="px-4 py-6 text-center text-muted">
                No groups yet — add one above, or guests can create/join one from the voting page.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function GroupAddModal({
  unassignedGuests,
  onAdd,
  onClose,
}: {
  unassignedGuests: Guest[];
  onAdd: (data: { name: string; creatorGuestId: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [creatorGuestId, setCreatorGuestId] = useState(unassignedGuests[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = name.trim().length > 0 && !!creatorGuestId;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await onAdd({ name: name.trim(), creatorGuestId });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add group.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add Group"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold uppercase text-text">Add Group</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-xl text-muted hover:text-text">
            ×
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field-input bg-bg px-3 py-2 text-text"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Initial member</label>
            {unassignedGuests.length === 0 ? (
              <p className="text-sm text-muted">
                No guests are available — every guest already belongs to a group.
              </p>
            ) : (
              <select
                value={creatorGuestId}
                onChange={(e) => setCreatorGuestId(e.target.value)}
                className="rounded border border-muted bg-bg px-3 py-2 text-text"
              >
                {unassignedGuests.map((guest) => (
                  <option key={guest.id} value={guest.id}>
                    {guest.firstName} {guest.lastName}
                  </option>
                ))}
              </select>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
              className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
            >
              {submitting ? "Adding…" : "Add Group"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GroupEditModal({
  group,
  members,
  unassignedGuests,
  onRename,
  onPhotoCropped,
  onAddMember,
  onRemoveMember,
  onDelete,
  onClose,
  placeholderImage,
}: {
  group: Group;
  members: Guest[];
  unassignedGuests: Guest[];
  onRename: (name: string) => Promise<void>;
  onPhotoCropped: (blob: Blob) => Promise<void>;
  onAddMember: (guestId: string) => Promise<void>;
  onRemoveMember: (guestId: string) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
  placeholderImage: string;
}) {
  const [name, setName] = useState(group.name);
  const [saving, setSaving] = useState(false);
  const [addingMemberId, setAddingMemberId] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = name.trim() !== group.name && name.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onRename(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoCropped(blob: Blob) {
    setError(null);
    try {
      await onPhotoCropped(blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    }
  }

  async function handleAddMember() {
    if (!addingMemberId) return;
    setAddingMember(true);
    setError(null);
    try {
      await onAddMember(addingMemberId);
      setAddingMemberId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member.");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(guest: Guest) {
    if (!window.confirm(`Remove ${guest.firstName} ${guest.lastName} from "${group.name}"?`)) {
      return;
    }
    setRemovingId(guest.id);
    setError(null);
    try {
      await onRemoveMember(guest.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove guest.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${group.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-lg bg-surface p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="min-w-0 truncate font-heading text-lg font-bold uppercase text-text">{group.name}</h2>
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 whitespace-nowrap rounded border border-red-400/60 px-2 py-1 text-xs font-heading font-bold uppercase text-red-400"
          >
            Delete
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <PhotoField
            photoUrl={group.photoUrl}
            alt={group.name}
            onCropped={handlePhotoCropped}
            placeholderImage={placeholderImage}
            size={72}
          />

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field-input bg-bg px-3 py-2 text-text"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted">Members</span>
            {members.length === 0 ? (
              <p className="text-sm text-muted">No members.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-2 rounded bg-bg px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-text">
                      {member.firstName} {member.lastName}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(member)}
                      disabled={removingId === member.id}
                      className="shrink-0 text-xs uppercase text-muted hover:text-red-400 disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {unassignedGuests.length > 0 && (
              <div className="flex gap-2">
                <select
                  value={addingMemberId}
                  onChange={(e) => setAddingMemberId(e.target.value)}
                  className="flex-1 rounded border border-muted bg-bg px-3 py-2 text-text"
                >
                  <option value="">Choose a guest…</option>
                  {unassignedGuests.map((guest) => (
                    <option key={guest.id} value={guest.id}>
                      {guest.firstName} {guest.lastName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddMember}
                  disabled={addingMember || !addingMemberId}
                  className="shrink-0 rounded bg-primary px-4 py-2 text-sm font-heading font-bold uppercase text-bg disabled:opacity-60"
                >
                  {addingMember ? "Adding…" : "Add"}
                </button>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
