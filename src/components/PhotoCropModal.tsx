"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";

interface PhotoCropModalProps {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}

// Every nominee photo is standardized to a 4:5 portrait crop (requirements:
// fixed aspect ratio across all guest and group photos, so the carousel and
// thumbnails never show blank space regardless of the source photo's shape).
const ASPECT_W = 4;
const ASPECT_H = 5;
const FRAME_WIDTH = 280;
const FRAME_HEIGHT = (FRAME_WIDTH * ASPECT_H) / ASPECT_W;
const OUTPUT_WIDTH = 960;
const OUTPUT_HEIGHT = (OUTPUT_WIDTH * ASPECT_H) / ASPECT_W;
const MAX_ZOOM = 3;

interface Offset {
  x: number;
  y: number;
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(-max, value));
}

/**
 * Lets whoever is uploading a photo drag to reposition and use a slider to
 * zoom, then confirms a 4:5 crop before it's saved — rather than relying on
 * the raw camera aspect ratio. Canvas-based (no cropper dependency): the
 * frame is a fixed-size viewport, the image is panned/scaled under it via
 * CSS transform, and confirming re-renders exactly the visible region onto
 * an offscreen canvas at a fixed output resolution.
 */
export function PhotoCropModal({ file, onCancel, onCropped }: PhotoCropModalProps) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; origin: Offset } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleImageLoad(e: SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  // baseScale makes the image cover the frame at zoom=1 (like object-fit:
  // cover) — the starting point before any user panning/zooming.
  const baseScale = naturalSize ? Math.max(FRAME_WIDTH / naturalSize.w, FRAME_HEIGHT / naturalSize.h) : 1;
  const effectiveScale = baseScale * zoom;
  const displayW = (naturalSize?.w ?? 0) * effectiveScale;
  const displayH = (naturalSize?.h ?? 0) * effectiveScale;
  const maxOffsetX = Math.max(0, (displayW - FRAME_WIDTH) / 2);
  const maxOffsetY = Math.max(0, (displayH - FRAME_HEIGHT) / 2);

  useEffect(() => {
    // Re-clamp whenever zoom changes the valid pan range (e.g. zooming out
    // could otherwise leave the image not fully covering the frame).
    // Intentionally keyed only on the range bounds, not offset itself.
    setOffset((prev) => ({ x: clamp(prev.x, maxOffsetX), y: clamp(prev.y, maxOffsetY) }));
  }, [maxOffsetX, maxOffsetY]);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (!naturalSize) return;
    dragState.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: offset };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setOffset({ x: clamp(drag.origin.x + dx, maxOffsetX), y: clamp(drag.origin.y + dy, maxOffsetY) });
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId === e.pointerId) dragState.current = null;
  }

  async function handleConfirm() {
    if (!naturalSize || !imgUrl) return;
    setSaving(true);
    setError(null);
    try {
      const img = new window.Image();
      img.src = imgUrl;
      await img.decode();

      const srcW = FRAME_WIDTH / effectiveScale;
      const srcH = FRAME_HEIGHT / effectiveScale;
      const srcX = Math.max(0, Math.min(naturalSize.w - srcW, (displayW - FRAME_WIDTH) / 2 / effectiveScale - offset.x / effectiveScale));
      const srcY = Math.max(0, Math.min(naturalSize.h - srcH, (displayH - FRAME_HEIGHT) / 2 / effectiveScale - offset.y / effectiveScale));

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_WIDTH;
      canvas.height = OUTPUT_HEIGHT;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not process image.");
      ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            setError("Could not process image.");
            setSaving(false);
            return;
          }
          onCropped(blob);
        },
        "image/jpeg",
        0.9,
      );
    } catch {
      setError("Could not process image. Please try a different photo.");
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop photo"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (!saving) onCancel();
      }}
    >
      <div
        className="flex flex-col items-center gap-4 rounded-lg bg-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-heading text-sm font-bold uppercase text-text">Center your photo</p>

        <div
          className="relative touch-none overflow-hidden rounded-lg bg-bg"
          style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {imgUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- needs pixel-precise drag/zoom transforms and later canvas access to its natural size; next/image's abstractions don't fit this interaction.
            <img
              src={imgUrl}
              alt="Photo to crop"
              draggable={false}
              onLoad={handleImageLoad}
              className="absolute left-1/2 top-1/2 max-w-none select-none"
              style={{
                width: naturalSize ? naturalSize.w * effectiveScale : undefined,
                height: naturalSize ? naturalSize.h * effectiveScale : undefined,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
        </div>

        <label className="flex w-full max-w-[280px] flex-col gap-1 text-xs text-muted">
          Zoom
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            disabled={!naturalSize}
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex w-full max-w-[280px] gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="flex-1 rounded bg-bg px-4 py-3 font-heading font-bold uppercase text-text disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || !naturalSize}
            className="flex-1 rounded bg-primary px-4 py-3 font-heading font-bold uppercase text-bg disabled:opacity-60"
          >
            {saving ? "Saving…" : "Use Photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
