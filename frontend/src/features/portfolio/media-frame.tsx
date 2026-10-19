import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import {
  GRID_IMAGE_SIZES,
  variantSrc,
  variantSrcSet,
  type MediaSource,
  type MediaUse,
} from "@/lib/media/image-variants";

/**
 * The frame every portfolio image sits in.
 *
 * A fixed ratio because a gallery of mixed aspect ratios reads as a broken layout
 * rather than as variety, and `object-cover` because a work photo cropped is still
 * the photo, while a letterboxed one is mostly empty card. This is what lets the
 * reference's image-led composition hold without knowing anything about what was
 * uploaded.
 *
 * DELIBERATELY NOT A CLIENT COMPONENT. It is a div with a class, and it is used by
 * the public profile and the hub — both server components — as well as by the
 * owner's manager. Leaving it in `parts.tsx` would have shipped `useActionState`,
 * the router and the whole manager's client bundle to a page that renders a
 * rectangle.
 */
export function MediaFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] w-full overflow-hidden rounded-md bg-surface-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The image inside a `MediaFrame` (or any fixed-ratio box).
 *
 * VARIANTS WHEN THEY EXIST, THE ORIGINAL WHEN THEY DO NOT. `source.variants` is
 * filled by the URL issuer for rows whose derived WebP variants were written at
 * verification; a grid then offers only `thumb` and `card` through `srcset`, and
 * the 1600 px `full` is reserved for `use="detail"`. Without variants this
 * renders exactly the original URL it always did.
 *
 * NO LAYOUT SHIFT: the frame fixes the ratio, and `width`/`height` give the
 * element an intrinsic ratio before any byte arrives. Lazy and async unless the
 * caller marks it as the above-the-fold image. The URLs are used verbatim —
 * nothing here appends a cache-busting parameter, so a re-render asks the
 * browser cache for the same URL rather than the network for a new one.
 *
 * A plain `<img>`: these are revocable application/edge URLs that next/image
 * must never cache (`media-image-cache.test.ts`).
 */
export function MediaImage({
  source,
  alt,
  use = "grid",
  sizes = GRID_IMAGE_SIZES,
  priority = false,
  width = 768,
  height = 576,
  className,
}: {
  source: MediaSource;
  alt: string;
  use?: MediaUse;
  sizes?: string;
  priority?: boolean;
  /** Intrinsic ratio hint; the default matches the 4:3 frame. */
  width?: number;
  height?: number;
  className?: string;
}) {
  const srcSet = variantSrcSet(source.variants, use);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- revocable media URL, never optimiser-cached
    <img
      src={variantSrc(source, use)}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className={cn("h-full w-full object-cover", className)}
    />
  );
}
