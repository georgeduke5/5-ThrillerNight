"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { PhotoCropModal } from "@/components/PhotoCropModal";

interface PhotoFieldProps {
  photoUrl: string | null;
  /** Alt text for the current photo, and used for the "Add/Change photo" label context. */
  alt: string;
  /** Called with the cropped 4:5 blob once the uploader confirms — the caller decides what to do with it (upload immediately, or hold it for later, e.g. until a not-yet-created guest gets an id). */
  onCropped: (blob: Blob) => void | Promise<void>;
  /** Shown in place of the photo when photoUrl is null — config.theme.placeholderImage, threaded down from the page rather than hardcoded here. */
  placeholderImage: string;
  disabled?: boolean;
  size?: number;
}

/**
 * Shared photo add/replace control: a small circular preview plus a file
 * input that opens the standard 4:5 crop modal before handing the result
 * back to the caller. Used for both guests (GuestManager) and groups
 * (GroupManager) so the crop-modal wiring exists in exactly one place.
 */
export function PhotoField({
  photoUrl,
  alt,
  onCropped,
  placeholderImage,
  disabled,
  size = 64,
}: PhotoFieldProps) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  // Optimistic local preview of whatever was just cropped, shown immediately
  // instead of waiting for the caller's upload to finish (or, for a
  // not-yet-created guest/group, instead of any real URL ever existing).
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPendingFile(file);
  }

  async function handleCropped(blob: Blob) {
    setPendingFile(null);
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
    setBusy(true);
    try {
      await onCropped(blob);
    } finally {
      setBusy(false);
    }
  }

  const displayUrl = localPreview ?? photoUrl ?? placeholderImage;

  return (
    <div className="flex items-center gap-3">
      <div
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg"
      >
        <Image
          src={displayUrl}
          alt={alt}
          width={size}
          height={size}
          className="h-full w-full object-cover"
          unoptimized
        />
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {photoUrl ? "Change photo" : "Add photo"}
        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={disabled || busy}
          className="text-text"
        />
      </label>

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
