import { describe, expect, it } from "vitest";
import { IMAGE_MAX_BYTES, MIB, VIDEO_MAX_BYTES, partitionUploadBatch, uploadRejection } from "./upload-limits";

const file = (name: string, size: number, type: string) => ({ name, size, type });

describe("per-file upload caps", () => {
  it("fixes the caps at 10 MB per image and 100 MB per video", () => {
    expect(IMAGE_MAX_BYTES).toBe(10 * MIB);
    expect(VIDEO_MAX_BYTES).toBe(100 * MIB);
  });

  it("accepts a file exactly at its cap and refuses one byte over", () => {
    expect(uploadRejection(file("a.jpg", IMAGE_MAX_BYTES, "image/jpeg"))).toBeNull();
    expect(uploadRejection(file("a.jpg", IMAGE_MAX_BYTES + 1, "image/jpeg"))).toBe("image_too_large");
    expect(uploadRejection(file("a.mp4", VIDEO_MAX_BYTES, "video/mp4"))).toBeNull();
    expect(uploadRejection(file("a.mp4", VIDEO_MAX_BYTES + 1, "video/mp4"))).toBe("video_too_large");
  });

  it("no longer applies the old 5 MB limit", () => {
    expect(uploadRejection(file("big.png", 6 * MIB, "image/png"))).toBeNull();
    expect(uploadRejection(file("big.webp", 9 * MIB, "image/webp"))).toBeNull();
  });

  it("refuses unsupported and empty files", () => {
    expect(uploadRejection(file("a.gif", 10, "image/gif"))).toBe("type_invalid");
    expect(uploadRejection(file("a.pdf", 10, "application/pdf"))).toBe("type_invalid");
    expect(uploadRejection(file("a.jpg", 0, "image/jpeg"))).toBe("empty");
  });

  it("rejects only the offending files and keeps the rest of a mixed batch", () => {
    const batch = partitionUploadBatch([
      file("ok-1.jpg", 2 * MIB, "image/jpeg"),
      file("too-big.png", 11 * MIB, "image/png"),
      file("clip.mp4", 90 * MIB, "video/mp4"),
      file("long.mov", 101 * MIB, "video/quicktime"),
      file("ok-2.webp", MIB, "image/webp"),
      file("notes.txt", 5, "text/plain"),
    ]);
    expect(batch.accepted.map((a) => [a.file.name, a.kind])).toEqual([
      ["ok-1.jpg", "image"],
      ["clip.mp4", "video"],
      ["ok-2.webp", "image"],
    ]);
    expect(batch.rejected.map((r) => [r.file.name, r.reason])).toEqual([
      ["too-big.png", "image_too_large"],
      ["long.mov", "video_too_large"],
      ["notes.txt", "type_invalid"],
    ]);
  });
});
