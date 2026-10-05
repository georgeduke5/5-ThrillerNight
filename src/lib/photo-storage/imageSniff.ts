/**
 * Identifies the actual image format from its file signature ("magic
 * bytes"), independent of whatever Content-Type a caller declared — that's
 * purely a client-reported header the caller fully controls (e.g. `curl -F
 * "file=@payload.html;type=image/jpeg"` sends whatever type you ask it to),
 * not a guarantee about the bytes that follow it. Returns null for anything
 * that doesn't match one of the four formats POST /api/photos accepts, so
 * an upload can be rejected on its real content rather than a claimed
 * label, and the Drive-stored mimeType reflects what the file actually is.
 */
export function sniffImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("latin1", 0, 4) === "RIFF" &&
    buffer.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 6 &&
    buffer.toString("latin1", 0, 3) === "GIF" &&
    (buffer.toString("latin1", 3, 6) === "87a" || buffer.toString("latin1", 3, 6) === "89a")
  ) {
    return "image/gif";
  }
  return null;
}

/**
 * Drive's "name" field is display metadata with no path semantics (Drive
 * uploads here always pass an explicit `parents` folder, so there's no
 * traversal risk from "../"), but a guest-supplied file name is still
 * free-text and unbounded — stripped down to a safe, length-capped set of
 * characters before it's woven into the stored filename, purely as
 * defensive hygiene rather than a response to any specific exploit through
 * this field.
 */
export function sanitizeFileNameComponent(name: string): string {
  const safe = name.replace(/[^\w.-]/g, "_");
  return safe.slice(0, 100) || "photo";
}
