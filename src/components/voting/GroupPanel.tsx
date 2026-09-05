"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import type { Group, Guest } from "@/lib/data-access";
import { PhotoCropModal } from "@/components/PhotoCropModal";

/**
 * Renders `children` in a portal anchored under `anchorRef`, positioned via
 * the anchor's real on-screen coordinates. This modal's own content area is
 * `overflow-y-auto` (needed since its content can be taller than the
 * screen) — an absolutely-positioned dropdown nested inside that gets
 * clipped by it whenever it would extend past whatever's currently
 * scrolled into view, no matter its z-index. Escaping to a portal at the
 * document root sidesteps that clipping (and any stacking-context issues)
 * entirely, which is the standard fix for a dropdown inside a scrollable
 * container. Position is recomputed continuously while open: on every
 * keystroke (the caller's match list, and so `children`, is a new element
 * each time), on resize/scroll from any ancestor (capture: true, including
 * the modal's own scrolling), and on the visual viewport resizing or
 * scrolling — how mobile browsers report the on-screen keyboard opening,
 * which shifts the input to a new position. Without tracking that, the
 * position would be computed once and go stale, leaving the dropdown
 * floating wherever the input *used* to be — including overlapping it —
 * rather than tracking where it actually ends up once the keyboard opens.
 */
function DropdownPortal({
  anchorRef,
  open,
  children,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    function updateRect() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom, left: r.left, width: r.width });
    }
    updateRect();
    const viewport = window.visualViewport;
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);
    viewport?.addEventListener("resize", updateRect);
    viewport?.addEventListener("scroll", updateRect);
    return () => {
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
      viewport?.removeEventListener("resize", updateRect);
      viewport?.removeEventListener("scroll", updateRect);
    };
    // Re-run on every render where `children` changed too (i.e. every
    // keystroke, since the caller's match list is a new element each
    // time) so position never goes stale between explicit events.
  }, [open, anchorRef, children]);

  if (!open || !rect || typeof document === "undefined") return null;

  return createPortal(
    <div
      style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
      className="z-[70]"
    >
      {children}
    </div>,
    document.body,
  );
}

interface GroupPanelProps {
  voter: Guest;
  guests: Guest[];
  groups: Group[];
  /** Called after any successful create/join/add/photo-upload so the caller can refetch guests+groups. */
  onChanged: () => void;
  onClose: () => void;
}

const MAX_MATCHES = 6;

/**
 * "Register your group" modal, opened from a link inside the Couple/Group
 * category card. Lets a guest create a group, join an existing one, or —
 * once in a group — add other guests and upload the group photo.
 */
export function GroupPanel({ voter, guests, groups, onChanged, onClose }: GroupPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newGroupName, setNewGroupName] = useState("");
  const [joinQuery, setJoinQuery] = useState("");
  const [addQuery, setAddQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<File | null>(null);
  const joinInputRef = useRef<HTMLInputElement>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const myGroup = useMemo(
    () => (voter.groupId ? (groups.find((g) => g.id === voter.groupId) ?? null) : null),
    [groups, voter.groupId],
  );

  const myGroupMembers = useMemo(
    () => (myGroup ? guests.filter((g) => g.groupId === myGroup.id) : []),
    [guests, myGroup],
  );

  const joinMatches = useMemo(() => {
    const q = joinQuery.trim().toLowerCase();
    if (!q) return [];
    return groups.filter((g) => g.name.toLowerCase().includes(q)).slice(0, MAX_MATCHES);
  }, [groups, joinQuery]);

  const addMatches = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (!q) return [];
    return guests
      .filter((g) => !g.groupId)
      .filter((g) => `${g.firstName} ${g.lastName}`.toLowerCase().includes(q))
      .slice(0, MAX_MATCHES);
  }, [guests, addQuery]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newGroupName, creatorGuestId: voter.id }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to create group.");
      setNewGroupName("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(groupId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId: voter.id, actingGuestId: voter.id }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to join group.");
      setJoinQuery("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to join group.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(guestId: string) {
    if (!myGroup) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${myGroup.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestId, actingGuestId: voter.id }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to add guest.");
      setAddQuery("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add guest.");
    } finally {
      setBusy(false);
    }
  }

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !myGroup) return;
    setError(null);
    setPendingPhoto(file);
  }

  async function handleCropped(blob: Blob) {
    if (!myGroup) return;
    setPendingPhoto(null);
    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", blob, "photo.jpg");
      formData.append("groupId", myGroup.id);
      const res = await fetch("/api/photos", { method: "POST", body: formData });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Failed to upload photo.");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload photo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Register your group"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold uppercase text-text">
            Your Group{myGroup ? `: ${myGroup.name}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-xl text-muted hover:text-text"
          >
            ×
          </button>
        </div>

        <>
          {myGroup ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg">
                  {myGroup.photoUrl ? (
                    <Image
                      src={myGroup.photoUrl}
                      alt={`${myGroup.name} photo`}
                      width={64}
                      height={64}
                      className="h-full w-full object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="text-3xl">🎭</span>
                  )}
                </div>
                <div>
                  <p className="font-heading font-bold uppercase text-text">{myGroup.name}</p>
                  <p className="text-sm text-muted">
                    {myGroupMembers.map((m) => `${m.firstName} ${m.lastName}`).join(", ")}
                  </p>
                </div>
              </div>

              <label className="flex flex-col gap-1 text-sm text-muted">
                {myGroup.photoUrl ? "Change group photo" : "Add a group photo"}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  disabled={uploading}
                  className="text-text"
                />
              </label>

              <div>
                <label htmlFor="add-member" className="mb-1 block text-sm text-muted">
                  Add someone to your group
                </label>
                <input
                  ref={addInputRef}
                  id="add-member"
                  type="text"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder="Search names…"
                  className="field-input w-full bg-bg px-4 py-2 text-text"
                />
                <DropdownPortal anchorRef={addInputRef} open={addMatches.length > 0}>
                  <ul className="mt-1 max-h-60 overflow-y-auto rounded border border-muted/30 bg-surface shadow-lg">
                    {addMatches.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleAddMember(g.id)}
                          className="block w-full px-4 py-2 text-left text-text hover:bg-bg"
                        >
                          {g.firstName} {g.lastName}
                        </button>
                      </li>
                    ))}
                  </ul>
                </DropdownPortal>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <form onSubmit={handleCreate} className="flex flex-col gap-2">
                <label htmlFor="new-group-name" className="text-sm text-muted">
                  Create a group
                </label>
                <div className="flex gap-2">
                  <input
                    id="new-group-name"
                    type="text"
                    required
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder="e.g. The Ghostbusters"
                    className="field-input flex-1 bg-bg px-4 py-2 text-text"
                  />
                  <button
                    type="submit"
                    disabled={busy || !newGroupName.trim()}
                    className="rounded bg-primary px-4 py-2 font-heading font-bold uppercase text-bg disabled:opacity-60"
                  >
                    Create
                  </button>
                </div>
              </form>

              <div>
                <label htmlFor="join-group" className="mb-1 block text-sm text-muted">
                  Or join an existing group
                </label>
                <input
                  ref={joinInputRef}
                  id="join-group"
                  type="text"
                  value={joinQuery}
                  onChange={(e) => setJoinQuery(e.target.value)}
                  placeholder="Search group names…"
                  className="field-input w-full bg-bg px-4 py-2 text-text"
                />
                <DropdownPortal anchorRef={joinInputRef} open={joinMatches.length > 0}>
                  <ul className="mt-1 max-h-60 overflow-y-auto rounded border border-muted/30 bg-surface shadow-lg">
                    {joinMatches.map((g) => (
                      <li key={g.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleJoin(g.id)}
                          className="block w-full px-4 py-2 text-left text-text hover:bg-bg"
                        >
                          {g.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </DropdownPortal>
              </div>
            </div>
          )}

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </>
      </div>

      {pendingPhoto && (
        <PhotoCropModal
          file={pendingPhoto}
          onCancel={() => setPendingPhoto(null)}
          onCropped={handleCropped}
        />
      )}
    </div>
  );
}
