import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND, LANDING, MOVED_ASSET_REDIRECTS } from "./registry";

const pub = (url: string) => join(__dirname, "..", "..", "..", "public", url);

describe("static asset registry", () => {
  it("points every registered asset at a file that exists", () => {
    for (const url of [...Object.values(BRAND), ...Object.values(LANDING)]) expect(existsSync(pub(url)), url).toBe(true);
  });
  it("redirects every moved URL to an existing file, and keeps no stale duplicate behind", () => {
    expect(MOVED_ASSET_REDIRECTS.length).toBeGreaterThanOrEqual(11);
    for (const { source, destination } of MOVED_ASSET_REDIRECTS) {
      expect(existsSync(pub(destination)), destination).toBe(true);
      expect(existsSync(pub(source)), `${source} must not also exist as a file`).toBe(false);
    }
  });
  it("never redirects a URL to itself", () => {
    for (const { source, destination } of MOVED_ASSET_REDIRECTS) expect(source).not.toBe(destination);
  });
});
