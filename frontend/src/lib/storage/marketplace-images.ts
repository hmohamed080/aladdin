/**
 * The Marketplace product-image contract (ADR-0028), following `product-images.ts`: a fast,
 * honest answer before anything uploads. It is NOT the authority — the `marketplace` media
 * namespace (20261112100013_marketplace_media.sql) and its receipt/resolver functions decide.
 * Photos are R2-only: there is no Supabase Storage bucket; `MARKETPLACE_IMAGE_BUCKET` is the
 * logical namespace name the image rows record.
 *
 * PURE ON PURPOSE — no `server-only`, no Supabase client.
 */
export const MARKETPLACE_IMAGE_BUCKET = "marketplace";
export const MARKETPLACE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MARKETPLACE_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** `<organization>/<product>/<image>.<ext>`, all three UUIDs — what the request-upload RPC mints. */
const KEY_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isMarketplaceImageKey(value: unknown): value is string {
  return typeof value === "string" && KEY_SHAPE.test(value);
}

/** `proofs/<order>/<receipt>.<ext>` — an InstaPay receipt the buyer uploads (Migration 14). */
const PROOF_SHAPE =
  /^proofs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function isMarketplaceProofKey(value: unknown): value is string {
  return typeof value === "string" && PROOF_SHAPE.test(value);
}

/** Any key of the `marketplace` media namespace: a product photo or a payment receipt. */
export function isMarketplaceMediaKey(value: unknown): value is string {
  return isMarketplaceImageKey(value) || isMarketplaceProofKey(value);
}

/**
 * Public URLs of one shop image: the Worker (Mode C, by image id) with its recorded sizes while public
 * edge delivery is on, otherwise the application route. Built on the server; rendered anywhere.
 */
export type MarketplaceImageUrls = { src: string; thumb?: string; card?: string; full?: string };
export type MarketplaceImageMap = Readonly<Record<string, MarketplaceImageUrls>>;

/** The best URL for `size`: that size when recorded, else the original; the app route when the map has no entry. */
export function marketplaceImageSrc(map: MarketplaceImageMap | undefined, imageId: string, size: "thumb" | "card" | "full"): string {
  const urls = map?.[imageId];
  return urls ? urls[size] ?? urls.src : `/marketplace/media/${imageId}?v=${size}`;
}
