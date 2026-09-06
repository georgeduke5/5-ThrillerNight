"use client";

import { useState } from "react";
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
 * Lean admin view of Couple/Group entries (requirements Section 5.4-style
 * oversight): groups are created/joined by guests themselves via the
 * voting page's GroupPanel — this is rename + photo (re)assignment. Photo
 * upload used to live on the standalone admin Photos page (now merged into
 * the Guests page for guests); the group-photo half of that moved here
 * rather than being dropped, since admins could tag a group's photo from
 * that page too.
 */
export function GroupManager({ initialGroups, guests, placeholderImage }: GroupManagerProps) {
  const [groups, setGroups] = useState(initialGroups);

  function memberNames(group: Group): string {
    return guests
      .filter((g) => group.memberIds.includes(g.id))
      .map((g) => `${g.firstName} ${g.lastName}`)
      .join(", ");
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

  return (
    <div className="surface-panel overflow-x-auto rounded-lg">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-bg text-muted">
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Members</th>
            <th className="px-4 py-2">Photo</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              members={memberNames(group)}
              onRename={handleRename}
              onPhotoCropped={(blob) => handlePhotoCropped(group.id, blob)}
              placeholderImage={placeholderImage}
            />
          ))}
          {groups.length === 0 && (
            <tr>
              <td colSpan={4} className="px-4 py-6 text-center text-muted">
                No groups yet — guests create or join one from the voting page.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function GroupRow({
  group,
  members,
  onRename,
  onPhotoCropped,
  placeholderImage,
}: {
  group: Group;
  members: string;
  onRename: (id: string, name: string) => Promise<void>;
  onPhotoCropped: (blob: Blob) => Promise<void>;
  placeholderImage: string;
}) {
  const [name, setName] = useState(group.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== group.name;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onRename(group.id, name);
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

  return (
    <tr className="border-b border-bg/50">
      <td className="px-4 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-40 rounded border border-transparent bg-transparent px-1 focus:border-muted focus:bg-bg"
        />
      </td>
      <td className="px-4 py-2 text-muted">{members || "—"}</td>
      <td className="px-4 py-2">
        <PhotoField
          photoUrl={group.photoUrl}
          alt={group.name}
          onCropped={handlePhotoCropped}
          placeholderImage={placeholderImage}
          size={40}
        />
      </td>
      <td className="px-4 py-2">
        {dirty && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-primary px-2 py-1 text-xs font-bold uppercase text-bg"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </td>
    </tr>
  );
}
