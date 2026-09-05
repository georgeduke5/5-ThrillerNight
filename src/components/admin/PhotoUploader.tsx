"use client";

import { useState, type ChangeEvent } from "react";
import Image from "next/image";
import type { Group, Guest } from "@/lib/data-access";
import { PhotoCropModal } from "@/components/PhotoCropModal";

interface PhotoUploaderProps {
  initialGuests: Guest[];
  initialGroups: Group[];
}

type TargetType = "guest" | "group";

/** Admin-side photo upload/tagging for guests and Couple/Group entries (requirements Section 5.3/5.4). */
export function PhotoUploader({ initialGuests, initialGroups }: PhotoUploaderProps) {
  const [guests, setGuests] = useState(initialGuests);
  const [groups, setGroups] = useState(initialGroups);
  const [targetType, setTargetType] = useState<TargetType>("guest");
  const [selectedId, setSelectedId] = useState(initialGuests[0]?.id ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const options = targetType === "guest" ? guests : groups;

  function handleTargetTypeChange(next: TargetType) {
    setTargetType(next);
    const list = next === "guest" ? guests : groups;
    setSelectedId(list[0]?.id ?? "");
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedId) return;
    setError(null);
    setPendingFile(file);
  }

  async function handleCropped(blob: Blob) {
    setPendingFile(null);
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", blob, "photo.jpg");
      formData.append(targetType === "guest" ? "guestId" : "groupId", selectedId);
      const res = await fetch("/api/photos", { method: "POST", body: formData });
      const body = (await res.json()) as { photoUrl?: string; photoRef?: string; error?: string };
      if (!res.ok || !body.photoUrl) throw new Error(body.error ?? "Failed to upload photo.");
      if (targetType === "guest") {
        setGuests((prev) =>
          prev.map((g) =>
            g.id === selectedId
              ? { ...g, photoUrl: body.photoUrl ?? null, photoRef: body.photoRef ?? null }
              : g,
          ),
        );
      } else {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === selectedId
              ? { ...g, photoUrl: body.photoUrl ?? null, photoRef: body.photoRef ?? null }
              : g,
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="surface-panel flex flex-wrap items-end gap-3 rounded-lg p-4">
        <div className="flex flex-col">
          <label className="text-xs text-muted">Type</label>
          <select
            value={targetType}
            onChange={(e) => handleTargetTypeChange(e.target.value as TargetType)}
            className="rounded border border-muted bg-bg px-3 py-2 text-text"
          >
            <option value="guest">Guest</option>
            <option value="group">Couple/Group</option>
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-muted">{targetType === "guest" ? "Guest" : "Group"}</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="rounded border border-muted bg-bg px-3 py-2 text-text"
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {"firstName" in o ? `${o.firstName} ${o.lastName}` : o.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-muted">Photo</label>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            disabled={uploading || !selectedId}
            className="text-text"
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div>
        <h3 className="mb-2 text-sm uppercase text-muted">Guests</h3>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
          {guests.map((guest) => (
            <PhotoThumb key={guest.id} label={`${guest.firstName} ${guest.lastName}`} photoUrl={guest.photoUrl} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm uppercase text-muted">Couple/Group</h3>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
          {groups.map((group) => (
            <PhotoThumb key={group.id} label={group.name} photoUrl={group.photoUrl} />
          ))}
          {groups.length === 0 && <p className="text-sm text-muted">No groups yet.</p>}
        </div>
      </div>

      {pendingFile && (
        <PhotoCropModal
          file={pendingFile}
          onCancel={() => setPendingFile(null)}
          onCropped={handleCropped}
        />
      )}
    </div>
  );
}

function PhotoThumb({ label, photoUrl }: { label: string; photoUrl: string | null }) {
  return (
    <div className="surface-panel flex flex-col items-center gap-1 rounded-lg p-2 text-center">
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-bg">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={label}
            width={80}
            height={80}
            className="h-full w-full object-cover"
            unoptimized
          />
        ) : (
          <span className="text-xl">🎭</span>
        )}
      </div>
      <p className="text-xs text-text">{label}</p>
    </div>
  );
}
