import { describe, expect, it } from "vitest";
import { sanitizeFileNameComponent, sniffImageMimeType } from "./imageSniff";

describe("sniffImageMimeType", () => {
  it("identifies a real JPEG by its signature", () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffImageMimeType(buffer)).toBe("image/jpeg");
  });

  it("identifies a real PNG by its signature", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(sniffImageMimeType(buffer)).toBe("image/png");
  });

  it("identifies a real WEBP by its signature", () => {
    const buffer = Buffer.concat([
      Buffer.from("RIFF", "latin1"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // file size (irrelevant to sniffing)
      Buffer.from("WEBP", "latin1"),
    ]);
    expect(sniffImageMimeType(buffer)).toBe("image/webp");
  });

  it("identifies a real GIF87a and GIF89a by their signature", () => {
    expect(sniffImageMimeType(Buffer.from("GIF87a", "latin1"))).toBe("image/gif");
    expect(sniffImageMimeType(Buffer.from("GIF89a", "latin1"))).toBe("image/gif");
  });

  it("rejects an HTML/script payload masquerading as an image, regardless of claimed Content-Type", () => {
    const payload = Buffer.from("<html><script>alert(document.cookie)</script></html>", "utf-8");
    expect(sniffImageMimeType(payload)).toBeNull();
  });

  it("rejects an SVG payload (not in the allowed signature list, even though it's technically an image format)", () => {
    const payload = Buffer.from('<svg onload="alert(1)"></svg>', "utf-8");
    expect(sniffImageMimeType(payload)).toBeNull();
  });

  it("rejects plain text and empty buffers", () => {
    expect(sniffImageMimeType(Buffer.from("just some text", "utf-8"))).toBeNull();
    expect(sniffImageMimeType(Buffer.alloc(0))).toBeNull();
  });

  it("rejects a buffer that's too short to contain any real signature", () => {
    expect(sniffImageMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe("sanitizeFileNameComponent", () => {
  it("leaves an ordinary filename unchanged", () => {
    expect(sanitizeFileNameComponent("costume.jpg")).toBe("costume.jpg");
    expect(sanitizeFileNameComponent("my-photo_2026.png")).toBe("my-photo_2026.png");
  });

  it("replaces path separators with underscores (dots themselves are allowed)", () => {
    expect(sanitizeFileNameComponent("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFileNameComponent("a/b\\c")).toBe("a_b_c");
  });

  it("replaces spaces, quotes, and other special characters", () => {
    expect(sanitizeFileNameComponent('my "photo" (1).jpg')).toBe("my__photo___1_.jpg");
  });

  it("caps length at 100 characters", () => {
    const longName = "a".repeat(500) + ".jpg";
    const result = sanitizeFileNameComponent(longName);
    expect(result.length).toBe(100);
  });

  it("falls back to a safe default if the sanitized result would be empty", () => {
    expect(sanitizeFileNameComponent("")).toBe("photo");
  });
});
