import { describe, expect, it } from "vitest";
import { formatClock, normalizeOrder, type PickedMedia } from "./media-picker";

const pick = (id: string, kind: "image" | "video"): PickedMedia => ({
  id,
  kind,
  file: new File([new Uint8Array([1])], `${id}.${kind === "video" ? "mp4" : "png"}`),
  previewUrl: `blob:${id}`,
  durationSeconds: kind === "video" ? 12 : null,
});

describe("normalizeOrder - the cover is always an image", () => {
  it("leaves an order alone when an image is already first", () => {
    const list = [pick("a", "image"), pick("v", "video"), pick("b", "image")];
    expect(normalizeOrder(list).map((m) => m.id)).toEqual(["a", "v", "b"]);
  });

  it("brings the first image forward when a video would be the cover", () => {
    const list = [pick("v", "video"), pick("a", "image"), pick("b", "image")];
    expect(normalizeOrder(list).map((m) => m.id)).toEqual(["a", "v", "b"]);
  });

  it("keeps a lone video (nothing to promote) and an empty list", () => {
    expect(normalizeOrder([pick("v", "video")]).map((m) => m.id)).toEqual(["v"]);
    expect(normalizeOrder([])).toEqual([]);
  });

  it("promotes the next image when the first image is removed from in front of a video", () => {
    const afterRemoval = [pick("v", "video"), pick("b", "image")];
    expect(normalizeOrder(afterRemoval)[0]?.id).toBe("b");
  });
});

describe("formatClock", () => {
  it("renders m:ss like the mock", () => {
    expect(formatClock(24)).toBe("0:24");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(600)).toBe("10:00");
  });
});
