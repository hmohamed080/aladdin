import { describe, expect, it } from "vitest";
import { isDecodeRefusal, isFinalRefusal } from "./content-refusal";
import { MetadataStripError } from "./image-processing/metadata-strip";

describe("which upload failures release the reservation", () => {
  it("releases a file over the limit, an unsupported one and one whose metadata cannot be removed", () => {
    for (const message of ["object too large", "invalid stored size", "unsupported image", "image does not fit the size limit once re-encoded"]) {
      expect(isFinalRefusal(new Error(message))).toBe(true);
    }
    expect(isFinalRefusal(new MetadataStripError())).toBe(true);
    expect(isDecodeRefusal(new Error("Input buffer contains unsupported image format"))).toBe(true);
  });

  it("keeps the reservation when a retry can succeed", () => {
    for (const message of ["object unavailable", "media verification busy; retry", "image processing quota exceeded", "image could not be processed", "fetch failed"]) {
      expect(isFinalRefusal(new Error(message))).toBe(false);
    }
    expect(isDecodeRefusal(new Error("media verification busy; retry"))).toBe(false);
    expect(isDecodeRefusal(new Error("image processing quota exceeded"))).toBe(false);
  });
});
