import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ADR-0032: a failed upload holds nothing. Files leave the browser only through `uploadWithGrant` (which releases the
 * reservation when it fails) or the resumable video engine (whose upload expires in the database). A new place that sends
 * bytes by itself would skip the release, so it fails here.
 */
const SRC = path.resolve(__dirname, "../..");
const SENDERS = ["features/video/upload-engine.ts", "lib/storage/browser-upload.ts"];
const SENDS = /uploadToSignedUrl\s*\(|\.open\(\s*["']PUT["']|storage\s*\.from\([^)]*\)\s*\.upload\s*\(/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe("browser uploads", () => {
  it("leave only through the two reviewed senders", () => {
    const found = sources(SRC)
      .filter((file) => SENDS.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).replaceAll("\\", "/"))
      .filter((file) => !file.startsWith("server/"))
      .sort();
    expect(found).toEqual(SENDERS);
  });
});
