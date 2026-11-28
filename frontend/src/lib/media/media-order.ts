/**
 * Photos and videos share one order (ADR-0020 Revision 2): a portfolio by
 * `sort_order` across portfolio_items and media_videos, a product gallery by
 * `slot` across product_images and media_videos. The database owns the order;
 * this only interleaves two lists that each arrive sorted.
 */
export type Positioned = { id: string; position?: number | null; createdAt?: string | null };
export type MediaEntry<I, V> = { kind: "image"; item: I } | { kind: "video"; item: V };

function compare(a: Positioned, b: Positioned): number {
  const pa = a.position ?? Number.MAX_SAFE_INTEGER;
  const pb = b.position ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  const ca = a.createdAt ?? "";
  const cb = b.createdAt ?? "";
  if (ca !== cb) return ca < cb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Each list keeps the order it arrived in; the two are interleaved by position. */
export function mergeMedia<I extends Positioned, V extends Positioned>(images: readonly I[], videos: readonly V[]): MediaEntry<I, V>[] {
  const out: MediaEntry<I, V>[] = [];
  let i = 0;
  let v = 0;
  while (i < images.length || v < videos.length) {
    const image = images[i];
    const video = videos[v];
    if (image !== undefined && (video === undefined || compare(image, video) <= 0)) {
      out.push({ kind: "image", item: image });
      i += 1;
    } else {
      out.push({ kind: "video", item: video! });
      v += 1;
    }
  }
  return out;
}
