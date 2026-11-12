import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architecture guard: application media bytes reach storage only through the provider layer
 * (`server/storage/media.ts` -> providers), where R2-only routing and the environment guard live.
 * Any other `supabase.storage.from(...)` is a second, unguarded path, so each one must be listed
 * here with its reason. Adding a caller means adding a line, which is a review conversation.
 */
const SRC = join(__dirname, "..", "..");
const ALLOWED: Record<string, string> = {
  "server/storage/supabase-provider.ts": "the legacy provider itself (reads and deletes of existing objects; writes closed once R2 is on)",
  "lib/storage/browser-upload.ts": "uploads with a server-issued grant; the server refuses to issue a Supabase grant once R2 is on",
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("Supabase Storage access", () => {
  const users = sources(SRC).filter((file) => /\.storage\s*\.from\(/.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file).replaceAll("\\", "/"));
  it("is limited to the listed callers", () => {
    expect(users.filter((file) => !(file in ALLOWED))).toEqual([]);
  });
  it("lists no caller that no longer exists", () => {
    expect(Object.keys(ALLOWED).filter((file) => !users.includes(file))).toEqual([]);
  });
});
