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
  // INTERIM, Marketplace (ADR-0028): product photos still live in the private Supabase bucket
  // `marketplace-product-images` until they move to the provider layer / R2 (database audit 2026-11-07, H1).
  // Behind NEXT_PUBLIC_MARKETPLACE_PREVIEW and the admin-granted marketplace.sell entitlement. Remove with the R2 move.
  "app/(workspace)/b2c/seller/products/page.tsx": "interim Marketplace photos: signed thumbnail URLs for the seller's own products",
  "app/admin/marketplace/media/page.tsx": "interim Marketplace photos: signed preview URLs for the moderation queue",
  "lib/supabase/admin-server.ts": "interim Marketplace photos: service-role download of an approved public image (marketplace_public_image_ref)",
  "server/actions/admin-marketplace.ts": "interim Marketplace photos: moderator downloads the bytes to validate them",
  "server/actions/marketplace-seller.ts": "interim Marketplace photos: seller upload URL and removal of a pending upload",
  "server/queries/marketplace-seller-catalog.ts": "interim Marketplace photos: signed URLs on the seller's product editor",
  "features/marketplace-seller/image-upload.ts": "interim Marketplace photos: browser upload to a server-issued signed upload URL",
  "features/marketplace-seller/import-wizard.tsx": "interim Marketplace photos: bulk-import photo upload to a server-issued signed upload URL",
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
