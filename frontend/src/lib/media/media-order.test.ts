import { describe, expect, it } from "vitest";
import { mergeMedia } from "./media-order";

describe("mergeMedia", () => {
  it("interleaves photos and videos by their shared position", () => {
    const images = [{ id: "i1", position: 0 }, { id: "i2", position: 2 }];
    const videos = [{ id: "v0", position: -1 }, { id: "v1", position: 1 }];
    expect(mergeMedia(images, videos).map((e) => `${e.kind}:${e.item.id}`)).toEqual(["video:v0", "image:i1", "video:v1", "image:i2"]);
  });

  it("puts a video first when it holds the first slot", () => {
    expect(mergeMedia([{ id: "a", position: 2 }, { id: "b", position: 3 }], [{ id: "v", position: 1 }])[0]).toEqual({ kind: "video", item: { id: "v", position: 1 } });
  });

  it("breaks ties by creation time, then id, and puts unknown positions last", () => {
    const out = mergeMedia([{ id: "b", position: 1, createdAt: "2026-01-02" }, { id: "z", position: null }],
      [{ id: "a", position: 1, createdAt: "2026-01-01" }]);
    expect(out.map((e) => e.item.id)).toEqual(["a", "b", "z"]);
  });

  it("keeps each list's own order when positions tie", () => {
    const out = mergeMedia([{ id: "en", position: 0 }, { id: "ar", position: 0 }], []);
    expect(out.map((e) => e.item.id)).toEqual(["en", "ar"]);
  });
});
