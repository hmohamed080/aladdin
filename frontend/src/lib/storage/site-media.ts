/**
 * Admin-managed dynamic site media (landing banners, hero backgrounds, promo
 * videos). It lives in its own R2 bucket (`R2_SITE_BUCKET`), never in the private
 * user-media bucket, under `site/shared/…` or `site/pages/<feature>/…`.
 *
 * Static website assets stay in the repository (`lib/assets/registry.ts`).
 * Keys hold only a feature slug and an id: no file names, no account data.
 */
const FEATURE = /^[a-z][a-z0-9-]{1,39}$/;
const MEDIA_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSION = /^(webp|png|jpg|mp4)$/;

export type SiteMediaScope = { kind: "shared" } | { kind: "page"; feature: string };

export function siteMediaKey(scope: SiteMediaScope, mediaId: string, extension: string): string {
  if (!MEDIA_ID.test(mediaId)) throw new Error("invalid site media id");
  if (!EXTENSION.test(extension)) throw new Error("invalid site media extension");
  if (scope.kind === "shared") return `site/shared/${mediaId}/original.${extension}`;
  if (!FEATURE.test(scope.feature)) throw new Error("invalid site media feature");
  return `site/pages/${scope.feature}/${mediaId}/original.${extension}`;
}

export function isSiteMediaKey(key: string): boolean {
  return /^site\/(shared|pages\/[a-z][a-z0-9-]{1,39})\/[0-9a-f-]{36}\/original\.(webp|png|jpg|mp4)$/.test(key);
}

/** User and organization media keys (ids-only layout) can never be site media, and vice versa. */
export function isAccountMediaKey(key: string): boolean {
  return /^(u|o)\/[0-9a-f-]{36}\//.test(key);
}
