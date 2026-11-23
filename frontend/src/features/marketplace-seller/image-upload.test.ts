import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/browser-upload", () => ({ uploadWithGrant: vi.fn() }));
vi.mock("@/server/actions/marketplace-seller", () => ({
  confirmImageUploadAction: vi.fn(),
  removeImageAction: vi.fn(),
  requestImageUploadAction: vi.fn(),
}));
vi.mock("@/features/video/upload-engine", () => ({ uploadVideo: vi.fn(), UploadFailure: class extends Error { code = "server"; } }));

import { MIB } from "@/lib/media/upload-limits";
import { resetMediaLimitHints } from "@/lib/media/limits-client";
import { imageFileProblem, uploadMediaBatch, uploadProductImages } from "./image-upload";
import { requestImageUploadAction } from "@/server/actions/marketplace-seller";

const file = (name: string, size: number, type: string) => ({ name, size, type }) as File;

describe("uploadMediaBatch", () => {
  afterEach(() => resetMediaLimitHints(null));

  it("follows the stored limits the browser was told: a raised image cap admits a 15 MB photo, a lowered video cap refuses a 60 MB video", async () => {
    const images = vi.fn(async () => []);
    const video = vi.fn(async () => null);
    resetMediaLimitHints([
      { kind: "image", place: "marketplace", maxBytes: 20 * MIB, defaultBytes: 10 * MIB, ceilingBytes: 20 * MIB, updatedAt: null },
      { kind: "video", place: "product", maxBytes: 50 * MIB, defaultBytes: 100 * MIB, ceilingBytes: 1024 * MIB, updatedAt: null },
    ]);
    const failures = await uploadMediaBatch("product-1", [file("big.jpg", 15 * MIB, "image/jpeg"), file("clip.mp4", 60 * MIB, "video/mp4")], undefined, { images, video });
    expect(images).toHaveBeenCalledTimes(1);
    expect(video).not.toHaveBeenCalled();
    expect(failures).toEqual([{ name: "clip.mp4", code: "video_too_large" }]);
  });

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

  it("the image uploader itself honours the raised limit: a 15 MB photo reaches the upload ticket, and a lowered limit refuses it", async () => {
    vi.mocked(requestImageUploadAction).mockResolvedValue({ ok: false, code: "stop" } as never);
    resetMediaLimitHints([{ kind: "image", place: "marketplace", maxBytes: 20 * MIB, defaultBytes: 10 * MIB, ceilingBytes: 20 * MIB, updatedAt: null }]);
    await uploadProductImages("product-1", [file("big.jpg", 15 * MIB, "image/jpeg")]);
    expect(requestImageUploadAction).toHaveBeenCalledTimes(1);
    expect(imageFileProblem(file("big.jpg", 15 * MIB, "image/jpeg"))).toBeNull();
    resetMediaLimitHints([{ kind: "image", place: "marketplace", maxBytes: 5 * MIB, defaultBytes: 10 * MIB, ceilingBytes: 20 * MIB, updatedAt: null }]);
    expect(imageFileProblem(file("big.jpg", 6 * MIB, "image/jpeg"))).toBe("file_too_large");
  });
});
