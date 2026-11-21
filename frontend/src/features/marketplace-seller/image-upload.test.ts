import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/browser-upload", () => ({ uploadWithGrant: vi.fn() }));
vi.mock("@/server/actions/marketplace-seller", () => ({
  confirmImageUploadAction: vi.fn(),
  removeImageAction: vi.fn(),
  requestImageUploadAction: vi.fn(),
}));
vi.mock("@/features/video/upload-engine", () => ({ uploadVideo: vi.fn(), UploadFailure: class extends Error { code = "server"; } }));

import { MIB } from "@/lib/media/upload-limits";
import { uploadMediaBatch } from "./image-upload";

const file = (name: string, size: number, type: string) => ({ name, size, type }) as File;

describe("uploadMediaBatch", () => {
  it("uploads images and videos together and refuses only the oversize file", async () => {
    const images = vi.fn(async () => []);
    const video = vi.fn(async () => null);
    const failures = await uploadMediaBatch(
      "product-1",
      [
        file("a.jpg", 3 * MIB, "image/jpeg"),
        file("huge.jpg", 12 * MIB, "image/jpeg"),
        file("b.png", 9 * MIB, "image/png"),
        file("tour.mp4", 80 * MIB, "video/mp4"),
      ],
      undefined,
      { images, video, videoEnabled: true },
    );
    // the two valid images go up as one ordered batch, the video runs beside them
    expect(images).toHaveBeenCalledTimes(1);
    expect((images.mock.calls[0] as unknown as [string, File[]])[1].map((f) => f.name)).toEqual(["a.jpg", "b.png"]);
    expect(video).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([{ name: "huge.jpg", code: "file_too_large" }]);
  });

  it("refuses an oversize video on its own while the images still upload", async () => {
    const images = vi.fn(async () => []);
    const video = vi.fn(async () => null);
    const failures = await uploadMediaBatch(
      "product-1",
      [file("a.webp", MIB, "image/webp"), file("film.mov", 150 * MIB, "video/quicktime")],
      undefined,
      { images, video, videoEnabled: true },
    );
    expect(images).toHaveBeenCalledTimes(1);
    expect(video).not.toHaveBeenCalled();
    expect(failures).toEqual([{ name: "film.mov", code: "video_too_large" }]);
  });

  it("reports every failure, from the browser check and from the upload itself", async () => {
    const images = vi.fn(async () => [{ name: "a.jpg", code: "upload_failed" }]);
    const video = vi.fn(async () => "video_upload_failed");
    const failures = await uploadMediaBatch(
      "product-1",
      [file("a.jpg", MIB, "image/jpeg"), file("v.mp4", MIB, "video/mp4"), file("notes.txt", 4, "text/plain")],
      undefined,
      { images, video, videoEnabled: true },
    );
    expect(failures.map((f) => [f.name, f.code]).sort()).toEqual([
      ["a.jpg", "upload_failed"],
      ["notes.txt", "file_type_invalid"],
      ["v.mp4", "video_upload_failed"],
    ]);
  });

  it("uploads nothing for a batch where every file is refused", async () => {
    const images = vi.fn(async () => []);
    const video = vi.fn(async () => null);
    const failures = await uploadMediaBatch("product-1", [file("x.jpg", 11 * MIB, "image/jpeg")], undefined, { images, video, videoEnabled: true });
    expect(images).not.toHaveBeenCalled();
    expect(failures).toHaveLength(1);
  });

  it("offers no video while the Marketplace has no video path: a video is refused, images still upload", async () => {
    const images = vi.fn(async () => []);
    const video = vi.fn(async () => null);
    const failures = await uploadMediaBatch("product-1", [file("a.jpg", MIB, "image/jpeg"), file("tour.mp4", MIB, "video/mp4")], undefined, { images, video });
    expect(video).not.toHaveBeenCalled();
    expect(images).toHaveBeenCalledTimes(1);
    expect(failures).toEqual([{ name: "tour.mp4", code: "file_type_invalid" }]);
  });
});
